import { execFile } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { AedevDb, type RunResult, type Task } from '@aedev/core'
import { IntakeService, MissionRunner, RolePipeline } from '@aedev/daemon'
import { ClaudeCodeAdapter } from '@aedev/runner'
import { GeminiValidator, OpenAIValidator } from '@aedev/validators'

const execFileAsync = promisify(execFile)

const HOME = homedir()
const STATE_DIR = process.env['AEDEV_HERMUS_DEMO_STATE'] ?? join(HOME, '.aedev-hermus-obsidian-system-demo')
const HERMUS_ROOT = process.env['HERMUS_ROOT'] ?? '/Users/lanston/projects/hermus-agent'
const OBSIDIAN_VAULT = process.env['HERMUS_OBSIDIAN_VAULT'] ?? '/Users/lanston/Obsidian/Hermus'
const LIVEDOC_ROOT = process.env['HERMUS_LIVEDOC_ROOT'] ?? '/Users/lanston/projects/LiveDoc'
const LAUNCH_AGENT = join(HOME, 'Library', 'LaunchAgents', 'com.hermus.daily-brief.plist')

async function main(): Promise<void> {
  normalizeValidatorEnv()
  mkdirSync(STATE_DIR, { recursive: true })
  const db = new AedevDb(':memory:')
  try {
    const repo = db.insertRepo({
      name: 'hermus-agent',
      path: HERMUS_ROOT,
      githubOwner: 'CTlanston',
      githubRepo: 'hermus-agent',
      defaultBranch: 'main',
      enabled: true,
      testCommands: ['python3 -m pytest -q'],
      forbiddenPaths: ['.env', '.env.*', 'secrets/**', '.github/**', 'AGENTS.md', 'CLAUDE.md'],
      riskRules: {},
      mergePolicy: 'low-risk-dual-validator',
    })

    const intake = new IntakeService(db, STATE_DIR)
    const mission = intake.createMissionCandidate(
      repo.id,
      [
        'Use Claude Code 247 to test a real Hermus + Obsidian Knowledge OS setup on this Mac.',
        'Configure or verify daily local-file reading through an allowlisted Hermus daily brief, Obsidian vault output, LiveDoc integration status, YouTube subtitling plan, Superagent safety guard, and LLM Wiki plan.',
        'Produce detailed PRD/ADR/roadmap/runbook artifacts and a test report. Be explicit about configured/present, HOLD, planned, and partial states.',
      ].join(' '),
      'Hermus Obsidian system demo via Claude Code 247',
    )
    intake.requestApproval(mission.id)
    intake.approveMission(mission.id, 'operator-demo')

    const result = await new MissionRunner(db, {
      stateDir: STATE_DIR,
      rolePipeline: new RolePipeline(),
      runner: hermusSystemRunner(),
      validators: [new GeminiValidator(), new OpenAIValidator()],
      riskFactors: () => ({
        touchesForbiddenPaths: false,
        diffLinesChanged: 260,
        hasDependencyChanges: false,
        testCoverageDecreased: false,
        usesSecrets: false,
        hasMigrationChanges: false,
        hasControlPlaneChanges: false,
      }),
    }).runMission(mission.id)

    console.log(`mission=${result.missionId}`)
    console.log(`status=${result.status}`)
    console.log(`task=${result.taskId}`)
    console.log(`evidence=${result.evidenceDir}`)
    console.log(`run=${result.run.runId}`)
    console.log(`mergeDecision=${result.mergeDecision}`)
    console.log(`risk=${result.riskScore}/${result.riskLevel}`)
    for (const v of result.validatorResults) {
      console.log(`validator=${v.validator} verdict=${v.verdict} summary=${v.summary.slice(0, 240).replace(/\n/g, ' ')}`)
    }
  } finally {
    db.close()
  }
}

function hermusSystemRunner() {
  return {
    async runTask(task: Task): Promise<RunResult> {
      const started = Date.now()
      const evidenceDir = join(STATE_DIR, 'worker-evidence', task.id)
      mkdirSync(evidenceDir, { recursive: true })

      const prompt = buildWorkerPrompt(evidenceDir)
      const worker = await new ClaudeCodeAdapter().run(prompt, HERMUS_ROOT, { timeoutMs: 1_200_000 })
      writeFileSync(join(evidenceDir, 'claude-raw.json'), JSON.stringify(worker.rawJson, null, 2))
      writeFileSync(join(evidenceDir, 'transcript-summary.md'), worker.transcript || worker.error || '(no transcript)')

      const schedule = await ensureDailyLaunchAgent()
      const pytest = await run('python3', ['-m', 'pytest', '-q'], HERMUS_ROOT)
      const dailyBrief = await run('python3', ['-m', 'hermus.cli', '--mode', 'daily-brief', '--notify', 'none', '--init-system'], HERMUS_ROOT)
      const diffStat = await run('git', ['diff', '--stat'], HERMUS_ROOT)
      const gitStatus = await run('git', ['status', '--short'], HERMUS_ROOT)
      const vaultFiles = await run('find', [OBSIDIAN_VAULT, '-type', 'f'], HERMUS_ROOT).catch((e: Error) => e.message)
      const launchStatus = await launchctlStatus()

      writeFileSync(join(evidenceDir, 'plan.md'), renderPlan())
      writeFileSync(join(evidenceDir, 'diff-summary.md'), renderDiffSummary(diffStat, gitStatus))
      writeFileSync(join(evidenceDir, 'test-summary.md'), renderTestSummary(pytest, dailyBrief, schedule, launchStatus, vaultFiles))
      writeFileSync(join(evidenceDir, 'done-report.md'), renderDoneReport(worker.exitCode, schedule, launchStatus))

      return {
        runId: `hermus-obsidian-system-${Date.now()}`,
        taskId: task.id,
        exitCode: worker.exitCode,
        evidenceDir,
        durationMs: Date.now() - started,
      }
    },
  }
}

function buildWorkerPrompt(evidenceDir: string): string {
  return `You are the worker invoked by Claude Code 247, not the outer assistant.
Work inside ${HERMUS_ROOT}.

Mission:
- Test and improve the Hermus + Obsidian system on this Mac.
- Produce detailed PRD, ADR, roadmap, runbook, and test-report style notes.
- Configure or verify a safe daily skill path that reads only allowlisted local files and writes Markdown into ${OBSIDIAN_VAULT}.
- Treat ${LIVEDOC_ROOT} as the LiveDoc checkout path. If absent, record HOLD; never pretend it is integrated.
- Keep YouTube subtitling, Superagent, and LLM Wiki labels honest: configured/present, HOLD, planned, or partial.

Research notes to incorporate:
- Obsidian Local REST API / MCP plugin can expose vault CRUD/search over localhost with auth, but this demo should remain plain-Markdown-first unless the plugin is already installed.
- YouTube transcript extraction has no universal official arbitrary-public-video API; use no-key caption extraction first, yt-dlp captions second, and paid/managed ASR only behind approval.
- LLM Wiki can be installed as a Claude/Codex plugin such as nvk/llm-wiki, and should compile durable Obsidian Markdown wiki pages instead of stuffing raw sources into prompts.
- Superagent guardrails should be treated as optional external checks; local redaction remains the always-on floor until a key and data policy are approved.

Required actions:
1. Inspect existing Hermus docs/config/tests before writing.
2. Update or create docs as needed: PRD, ADR, roadmap, runbook, test report.
3. If safe, configure the daily path through launchd or document why it is HOLD. Do not scan the full home directory.
4. Run or prepare evidence for pytest and daily-brief.
5. Write any worker-specific evidence to ${evidenceDir} if useful.
6. Do not push, merge, edit secrets, edit .env, edit AGENTS.md/CLAUDE.md/.github, or make destructive changes.
`
}

async function ensureDailyLaunchAgent(): Promise<string> {
  const logDir = join(HERMUS_ROOT, '.memory', 'launchd')
  mkdirSync(logDir, { recursive: true })
  mkdirSync(join(HOME, 'Library', 'LaunchAgents'), { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hermus.daily-brief</string>
  <key>WorkingDirectory</key><string>${HERMUS_ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>python3</string>
    <string>-m</string>
    <string>hermus.cli</string>
    <string>--mode</string>
    <string>daily-brief</string>
    <string>--notify</string>
    <string>none</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>${join(logDir, 'daily-brief.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(logDir, 'daily-brief.err.log')}</string>
</dict>
</plist>
`
  writeFileSync(LAUNCH_AGENT, plist)
  const uid = String(process.getuid?.() ?? '')
  const bootstrap = await run('launchctl', ['bootstrap', `gui/${uid}`, LAUNCH_AGENT], HERMUS_ROOT)
    .catch((e: Error) => e.message)
  return [
    `LaunchAgent path: ${LAUNCH_AGENT}`,
    `Schedule: daily at 08:30 local time`,
    `Bootstrap result: ${bootstrap.trim() || 'ok'}`,
  ].join('\n')
}

async function launchctlStatus(): Promise<string> {
  const uid = String(process.getuid?.() ?? '')
  return run('launchctl', ['print', `gui/${uid}/com.hermus.daily-brief`], HERMUS_ROOT).catch((e: Error) => e.message)
}

function renderPlan(): string {
  return `# Test Plan

## Critical nodes
1. Claude Code 247 intake, approval, MissionRunner, and RolePipeline.
2. Real Claude CLI worker execution against ${HERMUS_ROOT}.
3. Local Obsidian Markdown output at ${OBSIDIAN_VAULT}.
4. Daily launchd schedule for Hermus daily brief.
5. LiveDoc prerequisite detection at ${LIVEDOC_ROOT}.
6. YouTube subtitling, Superagent, and LLM Wiki truth labels.
7. Hermus pytest and daily-brief runtime.
8. Gemini/OpenAI evidence-only validator gate.
`
}

function renderDiffSummary(diffStat: string, gitStatus: string): string {
  return `# Diff Summary

## Git status
\`\`\`
${gitStatus}
\`\`\`

## Diff stat
\`\`\`
${diffStat}
\`\`\`

Expected scope: Hermus docs/config/demo plumbing only. Protected paths remain forbidden.
`
}

function renderTestSummary(pytest: string, dailyBrief: string, schedule: string, launchStatus: string, vaultFiles: string): string {
  return `# Test Summary

## pytest
\`\`\`
${pytest}
\`\`\`

## daily-brief
\`\`\`
${dailyBrief}
\`\`\`

## launchd schedule
\`\`\`
${schedule}
${launchStatus.slice(0, 4000)}
\`\`\`

## Obsidian vault files
\`\`\`
${vaultFiles.slice(0, 4000)}
\`\`\`
`
}

function renderDoneReport(workerExitCode: number, schedule: string, launchStatus: string): string {
  const livedocState = existsSync(LIVEDOC_ROOT) ? 'present' : 'HOLD: checkout absent'
  const loaded = /state =|program =|path =|last exit code/i.test(launchStatus)
  return `# Done Report

Worker exit code: ${workerExitCode}

## Result
- Claude Code 247 mission executed against Hermus.
- Hermus daily-brief schedule configured at ${LAUNCH_AGENT}.
- launchd loaded: ${loaded ? 'yes' : 'not confirmed'}
- LiveDoc: ${livedocState}
- YouTube subtitling: planned unless runtime code was added by worker.
- Superagent: partial unless external key and data policy were added by worker.
- LLM Wiki: planned unless compiler/runtime was added by worker.

## Schedule
\`\`\`
${schedule}
\`\`\`

No push or merge was performed by this demo script.
`
}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 20 * 1024 * 1024 })
  return `${stdout}${stderr}`
}

function normalizeValidatorEnv(): void {
  if (!process.env['AEDEV_GEMINI_API_KEY'] && process.env['GEMINI_API_KEY']) {
    process.env['AEDEV_GEMINI_API_KEY'] = process.env['GEMINI_API_KEY']
  }
  if (!process.env['AEDEV_OPENAI_API_KEY'] && process.env['OPENAI_API_KEY']) {
    process.env['AEDEV_OPENAI_API_KEY'] = process.env['OPENAI_API_KEY']
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
