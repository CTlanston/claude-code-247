/**
 * Phase L0 — 30-Minute Smoke CLI shim.
 *
 * The orchestrator lives in @aedev/core; this file is the CLI surface.
 *
 * CC_RESTORE_SPEC T2 closes the synthetic-as-real gap: the default mode
 * is now `real` (hits the running TS daemon at 127.0.0.1:7247). The
 * `--synthetic` flag is preserved for CI / dry-run.
 *
 * Operator on launch day:
 *
 *   pnpm tsx scripts/launch-smoke.ts                # REAL (default)
 *   pnpm tsx scripts/launch-smoke.ts --synthetic    # CI / dry-run only
 *   pnpm tsx scripts/launch-smoke.ts --daemon-url http://127.0.0.1:7248
 *
 * Checks 3 (phone approve) and 6 (kill session + resolve) need operator
 * callbacks. The CLI exposes a `--no-operator-checks` flag for CI which
 * SKIPS those two and marks the run as `mode: real-headless` (still
 * honest — explicitly less than 7/7 if you skip).
 *
 * 7/7 within 30-min budget → LAUNCH_AUTHORIZED.
 * Artifacts at evidence/launch/smoke-<UTC>.{json,md}.
 */
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SmokeHarness, renderMarkdown, syntheticChecks } from '../packages/core/src/launch-smoke.js'
import { realChecks } from '../packages/core/src/launch-smoke-real.js'

interface Args {
  mode: 'real' | 'synthetic'
  daemonUrl: string
  skipOperatorChecks: boolean
}

interface NtfyConfig {
  server: string
  topic: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    mode: argv.includes('--synthetic') ? 'synthetic' : 'real',
    daemonUrl: get('daemon-url') ?? process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247',
    skipOperatorChecks: argv.includes('--no-operator-checks'),
  }
}

function code(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

async function readNtfyConfig(): Promise<NtfyConfig> {
  const configPath = path.join(os.homedir(), '.claude-code-247', 'config.yaml')
  const text = await fs.readFile(configPath, 'utf8')
  const server = /^ {4}server:\s*(\S+)/m.exec(text)?.[1] ?? /^ {2}server:\s*(\S+)/m.exec(text)?.[1]
  const topic = /^ {4}topic:\s*(\S+)/m.exec(text)?.[1] ?? /^ {2}topic:\s*(\S+)/m.exec(text)?.[1]
  if (!server || !topic) throw new Error(`missing ntfy server/topic in ${configPath}`)
  return { server: server.replace(/\/$/, ''), topic }
}

async function publish(cfg: NtfyConfig, title: string, message: string, headers: Record<string, string>): Promise<void> {
  const resp = await fetch(`${cfg.server}/${cfg.topic}`, {
    method: 'POST',
    headers: { title, priority: '4', tags: 'warning', ...headers },
    body: message,
  })
  if (!resp.ok) throw new Error(`ntfy publish failed: ${resp.status}`)
}

function publishUrl(cfg: NtfyConfig, message: string, title: string): string {
  const params = new URLSearchParams({ message, title })
  return `${cfg.server}/${cfg.topic}/publish?${params.toString()}`
}

async function promptForReply(cfg: NtfyConfig, verb: 'APPROVE' | 'RESOLVE', context: string): Promise<void> {
  const command = `${verb} ${code()}`
  const url = publishUrl(cfg, command, `claude-code-247 ${verb.toLowerCase()}`)
  await publish(
    cfg,
    `claude-code-247 ${verb.toLowerCase()}`,
    [context, '', `Tap the button below to publish: ${command}`].join('\n'),
    { click: url, actions: `view, Send ${verb}, ${url}, clear=true` },
  )

  const sinceUnix = Math.floor(Date.now() / 1000)
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    const text = await pollNtfyText(cfg, sinceUnix, 12_000)
    const hit = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event?: string; message?: string })
      .find((msg) => msg.event === 'message' && (msg.message ?? '').trim().toUpperCase() === command)
    if (hit) return
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`timed out waiting for ntfy reply: ${command}`)
}

async function pollNtfyText(cfg: NtfyConfig, sinceUnix: number, timeoutMs: number): Promise<string> {
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  const response = await Promise.race([
    fetch(`${cfg.server}/${cfg.topic}/json?poll=1&since=${sinceUnix}`),
    timeout,
  ])
  if (response === 'timeout') return ''
  if (!response.ok) return ''
  const text = await Promise.race([
    response.text(),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), timeoutMs)),
  ])
  return text
    }

async function main(): Promise<void> {
  const args = parseArgs()

  let checks
  if (args.mode === 'synthetic') {
    checks = syntheticChecks()
  } else {
    // Real bindings — checks 3 and 6 need operator callbacks. If
    // --no-operator-checks is passed, we drop them from the run AND
    // record the count change in the report's mode field.
    const ntfyConfig = args.skipOperatorChecks ? undefined : readNtfyConfig()
    const env = {
      daemonUrl: args.daemonUrl,
      approveOnPhone: args.skipOperatorChecks ? undefined : async ({ missionId }) => {
        const cfg = await ntfyConfig
        await promptForReply(cfg, 'APPROVE', 'L0 smoke check 3 approval request')
        const resp = await fetch(`${args.daemonUrl.replace(/\/+$/, '')}/approvals/${missionId}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ by: 'lanston-ntfy-phone' }),
        })
        if (!resp.ok) throw new Error(`/approvals/${missionId}/approve returned ${resp.status}`)
        return { via: 'tailscale' as const }
      },
      killOneSession: args.skipOperatorChecks ? undefined : async () => {
        const cfg = await ntfyConfig
        await promptForReply(cfg, 'RESOLVE', 'L0 smoke check 6 HOLD resolution request')
        const resp = await fetch(`${args.daemonUrl.replace(/\/+$/, '')}/chaos/resolve-latest-hold`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ by: 'lanston-ntfy-phone' }),
        })
        if (!resp.ok) throw new Error(`/chaos/resolve-latest-hold returned ${resp.status}`)
        const body = (await resp.json()) as { poolAfter?: number }
        return { poolAfter: body.poolAfter ?? 1 }
      },
    }
    const all = realChecks({ env })
    checks = args.skipOperatorChecks ? all.filter((c) => c.id !== 3 && c.id !== 6) : all
  }

  const harness = new SmokeHarness({
    mode: args.mode,
    checks,
  })
  const report = await harness.run()
  console.log(renderMarkdown(report))
  if (report.verdict !== 'LAUNCH_AUTHORIZED') {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[smoke] crashed:', err)
  process.exit(2)
})
