import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileEventLog } from '../packages/event-log/src/index.js'
import { ProposalEmitter, runOnce } from '../packages/roadmap-agent/src/index.js'

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function stampForFile(ts: string): string {
  return ts.replace(/[:.]/g, '-')
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const p of paths) {
    try {
      await fs.access(p)
      return p
    } catch {
      // keep looking
    }
  }
  return paths[0]!
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const home = process.env['AEDEV_HOME'] ?? path.join(os.homedir(), '.claude-code-247', 'aedev-daemon')
  const eventDir = process.env['AEDEV_EVENT_DIR'] ?? path.join(home, 'events')
  const evidenceDir = argValue('--evidence-dir') ?? path.join(cwd, 'evidence', 'launch')
  const roadmapPath = argValue('--roadmap') ?? await firstExisting([
    path.join(cwd, 'roadmap.md'),
    path.join(cwd, 'docs', 'roadmap.md'),
  ])
  const startedAt = new Date().toISOString()
  const taskId = `roadmap_launch_${startedAt.replace(/[-:.TZ]/g, '')}`

  const log = new FileEventLog({ dir: eventDir })
  const emitter = new ProposalEmitter({ log, actor: 'launchd.roadmap-agent' })
  const result = await runOnce({ roadmapPath, taskId, emitter })
  const endedAt = new Date().toISOString()

  await fs.mkdir(evidenceDir, { recursive: true })
  const report = {
    started_at: startedAt,
    ended_at: endedAt,
    task_id: taskId,
    roadmap_path: roadmapPath,
    event_dir: eventDir,
    scanned: result.scanned,
    emitted: result.emitted,
    verdict: result.emitted > 0 ? 'PASS' : 'NO_PROPOSALS',
  }
  const base = path.join(evidenceDir, `roadmap-agent-tick-${stampForFile(startedAt)}`)
  await fs.writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  await fs.writeFile(`${base}.md`, [
    `# RoadmapAgent Tick - ${startedAt}`,
    '',
    `- Verdict: ${report.verdict}`,
    `- Task id: ${taskId}`,
    `- Roadmap: ${roadmapPath}`,
    `- Event dir: ${eventDir}`,
    `- Scanned: ${result.scanned}`,
    `- Emitted: ${result.emitted}`,
    '',
  ].join('\n'), 'utf8')

  console.log(JSON.stringify(report, null, 2))
  if (report.verdict !== 'PASS') {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[roadmap-agent-tick] failed:', err)
  process.exit(1)
})
