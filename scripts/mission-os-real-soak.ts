import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAdapter, CodexCliAdapter } from '@aedev/runner'

type Provider = 'claude' | 'codex'

interface ProviderReport {
  provider: Provider
  status: 'pass' | 'failed' | 'hold'
  available: boolean
  exitCode: number | null
  durationMs: number
  evidenceDir: string
  error?: string
}

interface RealSoakReport {
  schemaVersion: 1
  stageId: string
  startedAt: string
  endedAt: string
  status: 'pass' | 'failed' | 'hold'
  providers: ProviderReport[]
  reportPath: string
}

async function main(): Promise<void> {
  const stageId = readFlag('--stage') ?? 'audit'
  const providers = readProviders()
  const timeoutMs = Number(readFlag('--timeout-ms') ?? '120000')
  const outputDir = join(process.cwd(), 'evidence', 'v23', stageId)
  mkdirSync(outputDir, { recursive: true })
  const startedAt = new Date()

  const reports: ProviderReport[] = []
  for (const provider of providers) {
    reports.push(await runProvider(provider, outputDir, timeoutMs))
  }

  const status: RealSoakReport['status'] = reports.some((r) => r.status === 'failed')
    ? 'failed'
    : reports.some((r) => r.status === 'hold')
      ? 'hold'
      : 'pass'
  const reportPath = join(outputDir, 'real-soak.json')
  const report: RealSoakReport = {
    schemaVersion: 1,
    stageId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    providers: reports,
    reportPath,
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (status === 'failed') process.exit(1)
  if (status === 'hold') process.exit(2)
}

async function runProvider(provider: Provider, outputDir: string, timeoutMs: number): Promise<ProviderReport> {
  const evidenceDir = join(outputDir, `real-soak-${provider}`)
  mkdirSync(evidenceDir, { recursive: true })
  const workdir = mkdtempSync(join(tmpdir(), `aedev-real-soak-${provider}-`))
  const readme = join(workdir, 'README.md')
  const expectedLine = `${provider} real-soak OK`
  writeFileSync(readme, '# Real Soak\n')

  const startedAt = Date.now()
  try {
    if (provider === 'claude') {
      const adapter = new ClaudeCodeAdapter()
      const available = await adapter.isAvailable()
      if (!available) return hold(provider, evidenceDir, startedAt, 'claude CLI is not available')
      const result = await adapter.run(prompt(expectedLine), workdir, { timeoutMs })
      return finish(provider, evidenceDir, startedAt, result.exitCode, result.transcript.length, result.error)
    }

    const adapter = new CodexCliAdapter()
    const available = await adapter.isAvailable()
    if (!available) return hold(provider, evidenceDir, startedAt, 'codex CLI is not available')
    const result = await adapter.run(prompt(expectedLine), workdir, { timeoutMs })
    return finish(provider, evidenceDir, startedAt, result.exitCode, result.transcript.length, result.error)
  } catch (error) {
    return {
      provider,
      status: 'failed',
      available: true,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      evidenceDir,
      error: (error as Error).message,
    }
  } finally {
    const finalReadme = existsSync(readme) ? readFileSync(readme, 'utf8') : ''
    writeFileSync(join(evidenceDir, 'README.md'), finalReadme)
  }

  function finish(
    name: Provider,
    dir: string,
    started: number,
    exitCode: number,
    transcriptLength: number,
    error: string | undefined,
  ): ProviderReport {
    const finalReadme = existsSync(readme) ? readFileSync(readme, 'utf8') : ''
    const changed = finalReadme.includes(expectedLine)
    writeFileSync(join(dir, 'result-summary.json'), JSON.stringify({
      exitCode,
      transcriptLength,
      readmeChanged: changed,
      error: error ?? null,
    }, null, 2) + '\n')
    return {
      provider: name,
      status: exitCode === 0 && changed ? 'pass' : 'failed',
      available: true,
      exitCode,
      durationMs: Date.now() - started,
      evidenceDir: dir,
      ...(error ? { error } : {}),
    }
  }
}

function prompt(expectedLine: string): string {
  return [
    'You are running a Mission OS real-soak verification in a temporary repo.',
    `Append exactly this line to README.md: ${expectedLine}`,
    'Do not edit any other file. Keep the response brief.',
  ].join('\n')
}

function hold(provider: Provider, evidenceDir: string, startedAt: number, error: string): ProviderReport {
  writeFileSync(join(evidenceDir, 'HOLD.md'), `# HOLD-SESSION-POOL\n\n${error}\n`)
  return {
    provider,
    status: 'hold',
    available: false,
    exitCode: null,
    durationMs: Date.now() - startedAt,
    evidenceDir,
    error,
  }
}

function readProviders(): Provider[] {
  const value = readFlag('--providers')
  if (!value) return ['claude', 'codex']
  return value.split(',').filter((p): p is Provider => p === 'claude' || p === 'codex')
}

function readFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
