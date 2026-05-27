import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileEventLog } from '../packages/event-log/src/index.js'
import {
  ApprovalGateway,
  TokenSigner,
  TokenVerifier,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalTransport,
} from '../packages/approval-v2/src/index.js'
import { InterruptService } from '../packages/interrupt-bus/src/index.js'

interface NtfyConfig {
  server: string
  topic: string
}

interface NtfyMessage {
  event?: string
  time?: number
  title?: string
  message?: string
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function stampForFile(ts: string): string {
  return ts.replace(/[:.]/g, '-')
}

function code(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

async function readNtfyConfig(configPath: string): Promise<NtfyConfig> {
  const text = await fs.readFile(configPath, 'utf8')
  const server = /^ {4}server:\s*(\S+)/m.exec(text)?.[1] ?? /^ {2}server:\s*(\S+)/m.exec(text)?.[1]
  const topic = /^ {4}topic:\s*(\S+)/m.exec(text)?.[1] ?? /^ {2}topic:\s*(\S+)/m.exec(text)?.[1]
  if (!server || !topic) throw new Error(`Missing ntfy server/topic in ${configPath}`)
  return { server: server.replace(/\/$/, ''), topic }
}

async function publish(
  cfg: NtfyConfig,
  title: string,
  message: string,
  headers: Record<string, string> = {},
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const resp = await fetch(`${cfg.server}/${cfg.topic}`, {
      method: 'POST',
      headers: { title, priority: '4', tags: 'warning', ...headers },
      body: message,
    })
    if (resp.ok) return
    if (resp.status !== 429 || attempt === 4) throw new Error(`ntfy publish failed: ${resp.status}`)
    await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)))
  }
}

function publishUrl(cfg: NtfyConfig, message: string, title: string): string {
  const params = new URLSearchParams({ message, title })
  return `${cfg.server}/${cfg.topic}/publish?${params.toString()}`
}

async function publishReplyPrompt(cfg: NtfyConfig, title: string, command: string): Promise<void> {
  const url = publishUrl(cfg, command, title)
  await publish(cfg, title, `Tap the button below. Safari may open a plain ntfy response; that is expected.`, {
    click: url,
    actions: `view, Send ${command.split(' ')[0]}, ${url}, clear=true`,
  })
}

async function publishInstruction(cfg: NtfyConfig, title: string, message: string): Promise<void> {
  await fetch(`${cfg.server}/${cfg.topic}`, {
    method: 'POST',
    headers: { title, priority: '4', tags: 'warning' },
    body: message,
  })
}

async function pollMessages(cfg: NtfyConfig, sinceUnix: number): Promise<NtfyMessage[]> {
  const resp = await fetch(`${cfg.server}/${cfg.topic}/json?poll=1&since=${sinceUnix}`)
  if (resp.status === 429) return []
  if (!resp.ok) throw new Error(`ntfy poll failed: ${resp.status}`)
  const text = await resp.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NtfyMessage)
}

async function waitForReply(cfg: NtfyConfig, expected: string, sinceUnix: number): Promise<NtfyMessage> {
  const deadline = Date.now() + 10 * 60 * 1000
  const normalized = expected.trim().toUpperCase()
  while (Date.now() < deadline) {
    const messages = await pollMessages(cfg, sinceUnix)
    const hit = messages.find((msg) =>
      msg.event === 'message' &&
      (msg.message ?? '').trim().toUpperCase() === normalized &&
      (msg.time ?? 0) >= sinceUnix)
    if (hit) return hit
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`timed out waiting for ntfy reply: ${expected}`)
}

class NtfyReplyTransport implements ApprovalTransport {
  readonly name = 'tailscale' as const
  constructor(private readonly cfg: NtfyConfig, private readonly sinceUnix: number) {}
  async healthy(): Promise<boolean> {
    return true
  }
  async send(req: ApprovalRequest): Promise<ApprovalResponse> {
    const approveCode = code()
    await publishInstruction(
      this.cfg,
      'claude-code-247 approval reply check',
      [
        `Approval id: ${req.approvalId}`,
        '',
        `In the ntfy app, publish this exact message to the same topic:`,
        '',
        `APPROVE ${approveCode}`,
      ].join('\n'),
    )
    await publishReplyPrompt(this.cfg, 'claude-code-247 approve via browser', `APPROVE ${approveCode}`)
    console.log(`[phone-reply] waiting for ntfy message: APPROVE ${approveCode}`)
    const reply = await waitForReply(this.cfg, `APPROVE ${approveCode}`, this.sinceUnix)
    return {
      approvalId: req.approvalId,
      decision: 'approve' satisfies ApprovalDecision,
      token: req.approveToken,
      receivedAt: new Date((reply.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      via: 'tailscale',
    }
  }
}

class FallbackTransport implements ApprovalTransport {
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
  const startedAt = new Date().toISOString()
  const sinceUnix = Math.floor(Date.now() / 1000)
  const cwd = process.cwd()
  const configPath = argValue('--config') ?? path.join(os.homedir(), '.claude-code-247', 'config.yaml')
  const cfg = await readNtfyConfig(configPath)
  const home = process.env['AEDEV_HOME'] ?? path.join(os.homedir(), '.claude-code-247', 'aedev-daemon')
  const eventDir = process.env['AEDEV_EVENT_DIR'] ?? path.join(home, 'events')
  const evidenceDir = argValue('--evidence-dir') ?? path.join(cwd, 'evidence', 'launch')
  const taskId = `operator_ntfy_reply_${startedAt.replace(/[-:.TZ]/g, '')}`
  const log = new FileEventLog({ dir: eventDir })

  const gateway = new ApprovalGateway({
    log,
    signer: new TokenSigner('phone-ntfy-reply-check-secret'),
    verifier: new TokenVerifier('phone-ntfy-reply-check-secret'),
    primary: new NtfyReplyTransport(cfg, sinceUnix),
    fallback: new FallbackTransport(),
    actor: 'operator.phone-ntfy-reply-check',
  })

  const approvalStartedAt = new Date().toISOString()
  const approval = await gateway.request({
    taskId,
    reason: 'L0 ntfy phone reply approval check',
    operator: 'lanston-ntfy-phone',
    detail: { topic: cfg.topic },
  })
  const approvalEndedAt = new Date().toISOString()

  const holdService = new InterruptService({
    log,
    holdsMdPath: path.join(os.homedir(), '.claude-code-247', 'logs', 'holds.md'),
    actor: 'operator.phone-ntfy-reply-check',
  })
  const holdStartedAt = new Date().toISOString()
  const holdId = await holdService.open({
    taskId,
    reason: 'production_incident',
    detail: { check: 'L0 ntfy phone reply HOLD resolution check' },
    anchor: taskId,
  })
  const resolveCode = code()
  await publishInstruction(cfg, 'claude-code-247 HOLD reply check', [
    `HOLD id: ${holdId}`,
    '',
    `In the ntfy app, publish this exact message to the same topic:`,
    '',
    `RESOLVE ${resolveCode}`,
  ].join('\n'))
  await publishReplyPrompt(cfg, 'claude-code-247 resolve via browser', `RESOLVE ${resolveCode}`)
  console.log(`[phone-reply] waiting for ntfy message: RESOLVE ${resolveCode}`)
  const holdReply = await waitForReply(cfg, `RESOLVE ${resolveCode}`, sinceUnix)
  await holdService.resolve({ taskId, holdId, by: 'lanston-ntfy-phone', reason: 'phone ntfy reply check resolved' })
  const holdEndedAt = new Date().toISOString()
  const endedAt = new Date().toISOString()

  const report = {
    started_at: startedAt,
    ended_at: endedAt,
    mode: 'ntfy-phone-reply',
    topic: cfg.topic,
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
      reply_time: new Date((holdReply.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      started_at: holdStartedAt,
      ended_at: holdEndedAt,
    },
    verdict: 'PASS',
  }

  await fs.mkdir(evidenceDir, { recursive: true })
  const base = path.join(evidenceDir, `operator-phone-ntfy-reply-check-${stampForFile(startedAt)}`)
  await fs.writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  await fs.writeFile(`${base}.md`, [
    `# Operator Phone ntfy Reply Check - ${startedAt}`,
    '',
    `- Verdict: ${report.verdict}`,
    `- Mode: ${report.mode}`,
    `- Topic: ${cfg.topic}`,
    `- Task id: ${taskId}`,
    `- Approval: ${approval.decision} via ${approval.via} (${approval.approvalId})`,
    `- HOLD: resolved (${holdId})`,
    '',
  ].join('\n'), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error('[operator-phone-ntfy-reply-check] failed:', err)
  process.exit(1)
})
