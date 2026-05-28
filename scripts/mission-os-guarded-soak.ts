import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

interface GuardedSoakReport {
  schemaVersion: 1
  stageId: string
  mode: 'mock' | 'real' | 'draft-pr'
  startedAt: string
  endedAt: string
  durationMs: number
  iterationsRequested: number
  iterationsCompleted: number
  status: 'pass' | 'failed' | 'hold'
  failures: string[]
  acceptanceReports: string[]
  reportPath: string
}

async function main(): Promise<void> {
  const stageId = readFlag('--stage') ?? 'stage8'
  const mode = readMode()
  const durationMs = Number(readFlag('--duration-ms') ?? '120000')
  const intervalMs = Number(readFlag('--interval-ms') ?? '60000')
  const maxIterations = Number(readFlag('--max-iterations') ?? '0')
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const outputDir = join(process.cwd(), 'evidence', 'v23', stageId, `guarded-soak-${mode}`)
  mkdirSync(outputDir, { recursive: true })

  const failures: string[] = []
  const acceptanceReports: string[] = []
  let iterationsCompleted = 0
  const iterationLimit = maxIterations > 0 ? maxIterations : Number.POSITIVE_INFINITY

  while (Date.now() - started < durationMs && iterationsCompleted < iterationLimit) {
    iterationsCompleted++
    const iterationStage = `${stageId}-${mode}-${iterationsCompleted}`
    const acceptance = spawnSync('pnpm', ['test:mission-os:acceptance', '--', '--stage', iterationStage], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    writeFileSync(join(outputDir, `acceptance-${iterationsCompleted}.out`), acceptance.stdout ?? '')
    writeFileSync(join(outputDir, `acceptance-${iterationsCompleted}.err`), acceptance.stderr ?? '')
    const acceptancePath = join(process.cwd(), 'evidence', 'v23', iterationStage, 'acceptance.json')
    acceptanceReports.push(acceptancePath)
    if (acceptance.status !== 0) failures.push(`acceptance iteration ${iterationsCompleted} exited ${acceptance.status ?? 1}`)

    if (mode !== 'mock') {
      const real = spawnSync('pnpm', ['test:mission-os:real-soak', '--', '--stage', iterationStage, '--providers', 'claude,codex', '--timeout-ms', '180000'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      writeFileSync(join(outputDir, `real-soak-${iterationsCompleted}.out`), real.stdout ?? '')
      writeFileSync(join(outputDir, `real-soak-${iterationsCompleted}.err`), real.stderr ?? '')
      if (real.status !== 0) failures.push(`real soak iteration ${iterationsCompleted} exited ${real.status ?? 1}`)
    }

    if (Date.now() - started + intervalMs >= durationMs || iterationsCompleted >= iterationLimit) break
    await sleep(intervalMs)
  }

  const status = failures.length > 0 ? 'failed' : iterationsCompleted === 0 ? 'hold' : 'pass'
  const reportPath = join(outputDir, 'guarded-soak.json')
  const report: GuardedSoakReport = {
    schemaVersion: 1,
    stageId,
    mode,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    iterationsRequested: Number.isFinite(iterationLimit) ? iterationLimit : Math.ceil(durationMs / intervalMs),
    iterationsCompleted,
    status,
    failures,
    acceptanceReports: acceptanceReports.filter((path) => {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { status?: string }
        return parsed.status === 'pass'
      } catch {
        return false
      }
    }),
    reportPath,
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (status === 'failed') process.exit(1)
  if (status === 'hold') process.exit(2)
}

function readMode(): GuardedSoakReport['mode'] {
  const mode = readFlag('--mode')
  if (mode === 'real' || mode === 'draft-pr') return mode
  return 'mock'
}

function readFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
