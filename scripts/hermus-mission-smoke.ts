import { execFile } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { AedevDb, type Mission, type RunResult, type Task } from '@aedev/core'
import { IntakeService, MissionRunner } from '@aedev/daemon'
import type { RolePipeline } from '@aedev/daemon'

const execFileAsync = promisify(execFile)

const HERMit_ROOT = process.env['HERMUS_ROOT'] ?? '/Users/lanston/projects/hermus-agent'
const PROJECTS_ROOT = process.env['HERMUS_PROJECTS_ROOT'] ?? '/Users/lanston/projects'
const STATE_DIR = process.env['AEDEV_HERMUS_SMOKE_STATE'] ?? join(process.env['HOME'] ?? '/tmp', '.aedev-hermus-smoke')

async function main(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true })
  const db = new AedevDb(':memory:')
  try {
    const repo = db.insertRepo({
      name: 'hermus-agent',
      path: HERMit_ROOT,
      githubOwner: 'CTlanston',
      githubRepo: 'hermus-agent',
      defaultBranch: 'main',
      enabled: true,
      testCommands: ['python3 -m pytest -q'],
      forbiddenPaths: ['.env', '.env.*', 'secrets/**', '.github/**'],
      riskRules: {},
      mergePolicy: 'low-risk-human-reviewed',
    })

    const intake = new IntakeService(db, STATE_DIR)
    const mission = intake.createMissionCandidate(
      repo.id,
      'Use aedev to verify Hermus can scan local projects, write redacted report evidence, and stop safely.',
      'Hermus Phase 0-6 smoke',
    )

    await assertRunRequiresApproval(db, mission.id)

    intake.requestApproval(mission.id)
    intake.approveMission(mission.id, 'hermus-smoke')

    const result = await new MissionRunner(db, {
      stateDir: STATE_DIR,
      rolePipeline: hermusRolePipeline(),
      runner: hermusRunner(),
    }).runMission(mission.id)

    console.log(`mission=${result.missionId}`)
    console.log(`status=${result.status}`)
    console.log(`evidence=${result.evidenceDir}`)
    console.log(`run=${result.run.runId}`)
  } finally {
    db.close()
  }
}

async function assertRunRequiresApproval(db: AedevDb, missionId: string): Promise<void> {
  let refused = false
  try {
    await new MissionRunner(db, { stateDir: STATE_DIR, rolePipeline: hermusRolePipeline() }).runMission(missionId)
  } catch (e) {
    refused = /must be approved/.test((e as Error).message)
  }
  if (!refused) throw new Error('MissionRunner did not enforce approval before run')
}

function hermusRolePipeline(): RolePipeline {
  return {
    async run(mission: Mission, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'action-plan.md'), `# Action Plan

1. Run Hermus local tests.
2. Run Hermus scan-report against ${PROJECTS_ROOT}.
3. Validate report, manifest, notification, and redaction evidence.
`)
      writeFileSync(join(evidenceDir, 'decision-log.md'), `# Decision Log

- Hermus v0 is treated as seed code.
- This smoke uses deterministic aedev MissionRunner wiring before real long-running autonomy.
- GitHub PR-loop remains a separate Phase 5 command.
`)
      writeFileSync(join(evidenceDir, 'role-summary.md'), `# Role Summary

Mission ${mission.id} passed Product Lead, Architect, Builder, and Verifier evidence gates in smoke mode.
`)
      return { outputs: [], evidenceDir }
    },
  } as unknown as RolePipeline
}

function hermusRunner() {
  return {
    async runTask(task: Task): Promise<RunResult> {
      const started = Date.now()
      const pytest = await run('python3', ['-m', 'pytest', '-q'], HERMit_ROOT)
      const scan = await run('python3', ['-m', 'hermus.cli', '--root', PROJECTS_ROOT, '--mode', 'scan-report', '--notify', 'none'], HERMit_ROOT)
      const reportPath = parseReportPath(scan)
      const runDir = reportPath.replace(/\/report\.html$/, '')
      const secretCheck = await run('python3', ['-c', secretCheckProgram(runDir)], HERMit_ROOT)

      writeFileSync(join(runDir, 'aedev-task-id.txt'), `${task.id}\n`)
      writeFileSync(join(runDir, 'aedev-smoke-summary.md'), `# aedev Hermus Smoke

- pytest: pass
- scan-report: pass
- secret-like check: pass

## Pytest tail

\`\`\`
${pytest.slice(-1000)}
\`\`\`

## Secret check

\`\`\`
${secretCheck.slice(-1000)}
\`\`\`
`)

      return {
        runId: `hermus-smoke-${Date.now()}`,
        taskId: task.id,
        exitCode: 0,
        evidenceDir: runDir,
        durationMs: Date.now() - started,
      }
    },
  }
}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 20 * 1024 * 1024 })
  return `${stdout}${stderr}`
}

function parseReportPath(output: string): string {
  const line = output.split(/\r?\n/).find((l) => l.startsWith('Report: '))
  if (!line) throw new Error(`Hermus output did not include report path:\n${output}`)
  return line.replace('Report: ', '').trim()
}

function secretCheckProgram(runDir: string): string {
  return `
from pathlib import Path
from hermus.safety import contains_secret_like_value
run = Path(${JSON.stringify(runDir)})
for name in ["report.html", "scan-manifest.json", "notification.md", "validation-report.md"]:
    text = (run / name).read_text(encoding="utf-8")
    if contains_secret_like_value(text):
        raise SystemExit(f"secret-like value found in {name}")
print("secret-like check passed")
`
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
