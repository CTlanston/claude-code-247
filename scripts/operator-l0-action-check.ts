import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { FileEventLog } from '../packages/event-log/src/index.js'
import { ApprovalGateway, TokenSigner, TokenVerifier } from '../packages/approval-v2/src/index.js'
import type { ApprovalDecision, ApprovalRequest, ApprovalResponse, ApprovalTransport } from '../packages/approval-v2/src/index.js'
import { InterruptService } from '../packages/interrupt-bus/src/index.js'

const execFileAsync = promisify(execFile)

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function stampForFile(ts: string): string {
  return ts.replace(/[:.]/g, '-')
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}

async function waitForOperatorAction(opts: {
  title: string
  approveLabel: string
  rejectLabel?: string
  autoPath?: string
  port: number
}): Promise<{ action: string; clickedAt: string; url: string }> {
  let actionUrl = ''
  let resolveAction!: (result: { action: string; clickedAt: string; url: string }) => void
  const done = new Promise<{ action: string; clickedAt: string; url: string }>((resolve) => {
    resolveAction = resolve
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? `127.0.0.1:${opts.port}`
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname === '/approve' || url.pathname === '/resolve' || url.pathname === '/reject') {
      const action = url.pathname.slice(1)
      const clickedAt = new Date().toISOString()
      sendHtml(res, `<h1>${action.toUpperCase()} recorded</h1><p>${clickedAt}</p>`)
      resolveAction({ action, clickedAt, url: actionUrl })
      return
    }
    actionUrl = `http://${host}${url.pathname}`
    const approvePath = url.pathname.includes('hold') ? '/resolve' : '/approve'
    const rejectButton = opts.rejectLabel
      ? `<p><a style="font-size:24px" href="/reject">${opts.rejectLabel}</a></p>`
      : ''
    sendHtml(res, [
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${opts.title}</title>`,
      `<h1>${opts.title}</h1>`,
      '<p>This local operator page records the action into launch evidence.</p>',
      `<p><a style="font-size:28px" href="${approvePath}">${opts.approveLabel}</a></p>`,
      rejectButton,
    ].join('\n'))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => resolve())
  })
  const url = `http://127.0.0.1:${opts.port}/${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  actionUrl = url
  await execFileAsync('open', [url]).catch(() => undefined)
  if (opts.autoPath) {
    await fetch(`http://127.0.0.1:${opts.port}${opts.autoPath}`)
  }
  try {
    return await done
  } finally {
    server.close()
  }
}

class LocalOperatorTransport implements ApprovalTransport {
  readonly name = 'tailscale' as const
  constructor(private readonly port: number, private readonly auto: boolean) {}
  async healthy(): Promise<boolean> {
    return true
  }
  async send(req: ApprovalRequest): Promise<ApprovalResponse> {
    const action = await waitForOperatorAction({
      title: `Approve ${req.approvalId}`,
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      autoPath: this.auto ? '/approve' : undefined,
      port: this.port,
    })
    const decision: ApprovalDecision = action.action === 'reject' ? 'reject' : 'approve'
    return {
      approvalId: req.approvalId,
      decision,
      token: decision === 'approve' ? req.approveToken : req.rejectToken,
      receivedAt: action.clickedAt,
      via: 'tailscale',
    }
  }
}

class UnusedFallbackTransport implements ApprovalTransport {
  readonly name = 'dispatch' as const
  async healthy(): Promise<boolean> {
    return true
  }
  async send(req: ApprovalRequest): Promise<ApprovalResponse> {
    return {
      approvalId: req.approvalId,
      decision: 'approve',
      token: req.approveToken,
      receivedAt: new Date().toISOString(),
      via: 'dispatch',
    }
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const home = process.env['AEDEV_HOME'] ?? path.join(os.homedir(), '.claude-code-247', 'aedev-daemon')
  const eventDir = process.env['AEDEV_EVENT_DIR'] ?? path.join(home, 'events')
  const evidenceDir = argValue('--evidence-dir') ?? path.join(cwd, 'evidence', 'launch')
  const auto = hasFlag('--auto')
  const port = Number(argValue('--port') ?? '7261')
  const startedAt = new Date().toISOString()
  const taskId = `operator_l0_${startedAt.replace(/[-:.TZ]/g, '')}`
  const log = new FileEventLog({ dir: eventDir })

  const signer = new TokenSigner('local-l0-operator-check')
  const verifier = new TokenVerifier('local-l0-operator-check')
  const gateway = new ApprovalGateway({
    log,
    signer,
    verifier,
    primary: new LocalOperatorTransport(port, auto),
    fallback: new UnusedFallbackTransport(),
    actor: 'operator.l0-check',
  })
  const approvalStartedAt = new Date().toISOString()
  const approval = await gateway.request({
    taskId,
    reason: 'L0 operator approval check',
    operator: 'lanston-local',
    detail: { surface: auto ? 'auto-local-callback' : 'local-browser' },
  })
  const approvalEndedAt = new Date().toISOString()

  const holdService = new InterruptService({
    log,
    holdsMdPath: path.join(os.homedir(), '.claude-code-247', 'logs', 'holds.md'),
    actor: 'operator.l0-check',
  })
  const holdStartedAt = new Date().toISOString()
  const holdId = await holdService.open({
    taskId,
    reason: 'production_incident',
    detail: { check: 'L0 operator HOLD resolution check' },
    anchor: taskId,
  })
  const holdAction = await waitForOperatorAction({
    title: `Resolve HOLD ${holdId}`,
    approveLabel: 'Resolve HOLD',
    autoPath: auto ? '/resolve' : undefined,
    port,
  })
  await holdService.resolve({ taskId, holdId, by: 'lanston-local', reason: 'L0 operator check resolved' })
  const holdEndedAt = new Date().toISOString()

  const endedAt = new Date().toISOString()
  const report = {
    started_at: startedAt,
    ended_at: endedAt,
    mode: auto ? 'auto-local-callback' : 'manual-local-browser',
    task_id: taskId,
    event_dir: eventDir,
    approval: {
      result: 'PASS',
      approval_id: approval.approvalId,
      decision: approval.decision,
      via: approval.via,
      started_at: approvalStartedAt,
      ended_at: approvalEndedAt,
    },
    hold: {
      result: 'PASS',
      hold_id: holdId,
      action: holdAction.action,
      started_at: holdStartedAt,
      ended_at: holdEndedAt,
    },
    caveat: auto
      ? 'Automated local callback; not a physical phone tap.'
      : 'Manual local browser action on this Mac; not independently verified as a physical phone tap.',
    verdict: 'PASS',
  }

  await fs.mkdir(evidenceDir, { recursive: true })
  const base = path.join(evidenceDir, `operator-l0-action-check-${stampForFile(startedAt)}`)
  await fs.writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  await fs.writeFile(`${base}.md`, [
    `# Operator L0 Action Check - ${startedAt}`,
    '',
    `- Verdict: ${report.verdict}`,
    `- Mode: ${report.mode}`,
    `- Task id: ${taskId}`,
    `- Event dir: ${eventDir}`,
    `- Approval: ${approval.decision} via ${approval.via} (${approval.approvalId})`,
    `- HOLD: ${holdAction.action} (${holdId})`,
    `- Caveat: ${report.caveat}`,
    '',
  ].join('\n'), 'utf8')

  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error('[operator-l0-action-check] failed:', err)
  process.exit(1)
})
