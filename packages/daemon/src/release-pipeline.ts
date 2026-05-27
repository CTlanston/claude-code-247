// eslint-disable-next-line no-restricted-imports -- TODO(GR8): release-pipeline runs `git` shellouts inside the daemon process; pre-v2.1 carry-over. Migration plan: move git ops into a worker subprocess (or inject a GitClient) before v2.1.0 GA. ADR-0011 open-items.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Mission, MergePolicyDecision } from '@aedev/core'

const execFileAsync = promisify(execFile)

/**
 * Release pipeline orchestration for Phase 8 — wraps merge → deploy →
 * healthcheck → direct-revert-on-fail.  Per the migration plan:
 *
 *   Auto production deploy requires low-risk merge, dual validator PASS,
 *   preview smoke PASS, healthcheck URL configured, direct revert enabled,
 *   post-deploy health window PASS.  On any failure during the health
 *   window, `git revert <mergeSha>` runs directly and an incident report
 *   is written.
 *
 * Concrete merge + deploy invocations are injected (gitClient, deployFn,
 * fetchFn) so the same orchestration is testable without ever shelling
 * out to git or pushing a real container.
 */
export interface GitClient {
  /** Resolve the commit SHA of the named ref (e.g. 'main'). */
  resolveSha(ref: string): Promise<string>
  /** Run `git revert -m 1 <sha>` and return the new HEAD sha. */
  revertMerge(mergeSha: string, opts?: { reason?: string }): Promise<string>
}

export interface DeployRequest {
  mission: Mission
  /** Local build output directory. */
  outputDir: string
  /** Branch the deploy targets — `main` for production. */
  branch: 'main' | string
  /** True iff this is a production deploy (vs a preview). */
  production: boolean
}

export interface DeployResult {
  /** Deployed URL (preview or production). */
  url: string | null
  /** Provider-supplied metadata. */
  meta: Record<string, unknown>
  /** Set if the deploy never reached "deployed" state. */
  error?: string
  /** True iff the deploy needs a secret grant before it can run. */
  requiresSecretGrant?: boolean
  requiredSecretName?: string
}

export type DeployFn = (req: DeployRequest) => Promise<DeployResult>

export interface HealthcheckOptions {
  /** Total time to wait for healthcheck to come up.  Default 5 minutes. */
  totalTimeoutMs?: number
  /** Interval between probes.  Default 5 s. */
  intervalMs?: number
  /** Required consecutive successes before considering deploy healthy.  Default 2. */
  consecutiveSuccessesRequired?: number
  /** HTTP status code(s) considered healthy.  Default [200]. */
  healthyStatuses?: number[]
  /** Injected fetch (default global fetch). */
  fetchFn?: typeof fetch
  /** Injected sleep (default real setTimeout).  Tests use a no-op. */
  sleepFn?: (ms: number) => Promise<void>
}

export interface ReleasePipelineOptions {
  /** Where to write incident reports.  Default: <cwd>/incidents/. */
  incidentsDir?: string
}

export interface ReleaseRequest {
  mission: Mission
  decision: MergePolicyDecision
  /** SHA of the merge commit (must be already merged before this pipeline runs). */
  mergeSha: string
  /** Healthcheck URL — checked after production deploy. */
  healthcheckUrl?: string
  /** If true, run `deployFn` with production: true after merge. */
  productionDeployEnabled?: boolean
  /** Required for production deploy.  Output build dir. */
  outputDir?: string
  /** Safety allowlist: this pipeline may revert only merge SHAs created by the current E2E/run. */
  ownedMergeShas?: string[]
}

export interface ReleaseResult {
  mission: string
  decision: MergePolicyDecision
  mergeSha: string
  deployUrl: string | null
  deployRequiresSecretGrant: boolean
  deployRequiredSecretName?: string
  healthcheckPassed: boolean
  reverted: boolean
  revertSha?: string
  incidentPath?: string
  notes: string[]
}

export class ReleasePipeline {
  private readonly opts: ReleasePipelineOptions

  constructor(
    private readonly git: GitClient,
    private readonly deployFn: DeployFn,
    opts: ReleasePipelineOptions = {},
  ) {
    this.opts = opts
  }

  /**
   * Run the post-merge release flow.  The caller is responsible for
   * actually performing the merge (the GitHub PR layer does this); this
   * pipeline takes the mergeSha and decides whether to deploy + how to
   * react to a failing healthcheck.
   */
  async release(req: ReleaseRequest, healthcheck: HealthcheckOptions = {}): Promise<ReleaseResult> {
    const result: ReleaseResult = {
      mission: req.mission.id,
      decision: req.decision,
      mergeSha: req.mergeSha,
      deployUrl: null,
      deployRequiresSecretGrant: false,
      healthcheckPassed: false,
      reverted: false,
      notes: [],
    }

    if (req.decision !== 'AUTO_MERGE') {
      result.notes.push(`Merge decision was ${req.decision}; release pipeline is a no-op.`)
      return result
    }

    if (req.ownedMergeShas && !req.ownedMergeShas.includes(req.mergeSha)) {
      result.notes.push(`Merge ${req.mergeSha} is not owned by this run — refusing deploy/revert.`)
      return result
    }

    if (!req.productionDeployEnabled) {
      result.notes.push('Production deploy disabled for this mission — release ends after merge.')
      return result
    }

    if (!req.outputDir) {
      result.notes.push('No outputDir supplied — cannot deploy.')
      return result
    }

    // 1. Deploy to production
    const deploy = await this.deployFn({
      mission: req.mission,
      outputDir: req.outputDir,
      branch: 'main',
      production: true,
    })
    result.deployUrl = deploy.url
    if (deploy.requiresSecretGrant) {
      result.deployRequiresSecretGrant = true
      result.deployRequiredSecretName = deploy.requiredSecretName
      result.notes.push(`Deploy requires secret grant for ${deploy.requiredSecretName ?? '(unspecified)'} — release paused.`)
      return result
    }
    if (deploy.error || !deploy.url) {
      result.notes.push(`Deploy failed: ${deploy.error ?? 'no URL returned'}.  Reverting merge.`)
      const revert = await this.git.revertMerge(req.mergeSha, { reason: `deploy failed for mission ${req.mission.id}` })
      result.reverted = true
      result.revertSha = revert
      result.incidentPath = this.recordIncident(req.mission, {
        cause: deploy.error ?? 'deploy returned no URL',
        mergeSha: req.mergeSha,
        revertSha: revert,
        healthcheck: 'not reached',
      })
      return result
    }

    // 2. Healthcheck (if URL configured)
    if (!req.healthcheckUrl) {
      result.notes.push('Deploy succeeded but no healthcheck URL configured — release ends without verification.')
      return result
    }
    const hc = await runHealthcheck(req.healthcheckUrl, healthcheck)
    result.healthcheckPassed = hc.passed
    if (!hc.passed) {
      const revert = await this.git.revertMerge(req.mergeSha, { reason: `healthcheck failed for mission ${req.mission.id}` })
      result.reverted = true
      result.revertSha = revert
      result.incidentPath = this.recordIncident(req.mission, {
        cause: `Healthcheck failed: ${hc.reason}`,
        mergeSha: req.mergeSha,
        revertSha: revert,
        deployUrl: deploy.url,
        healthcheck: 'failed',
        probes: hc.probes,
      })
      return result
    }
    result.notes.push(`Deploy + healthcheck succeeded.  Deployed URL: ${deploy.url}`)
    return result
  }

  recordIncident(mission: Mission, payload: Record<string, unknown>): string {
    const dir = this.opts.incidentsDir ?? join(process.cwd(), 'incidents')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${mission.id}-${Date.now()}.md`)
    const md = [
      `# Incident — ${mission.title} (${mission.id})`,
      ``,
      `**Recorded:** ${new Date().toISOString()}`,
      `**Repo:** ${mission.repoId}`,
      ``,
      '## Payload',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
      '',
    ].join('\n')
    writeFileSync(path, md)
    return path
  }
}

interface HealthcheckProbe { at: string; status: number | null; ok: boolean; error?: string }

interface HealthcheckResult { passed: boolean; reason: string; probes: HealthcheckProbe[] }

async function runHealthcheck(url: string, opts: HealthcheckOptions): Promise<HealthcheckResult> {
  const totalTimeoutMs = opts.totalTimeoutMs ?? 5 * 60_000
  const intervalMs = opts.intervalMs ?? 5_000
  const consecutiveRequired = opts.consecutiveSuccessesRequired ?? 2
  const healthyStatuses = new Set(opts.healthyStatuses ?? [200])
  const fetchFn = opts.fetchFn ?? globalThis.fetch
  const sleepFn = opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  const deadline = Date.now() + totalTimeoutMs
  const probes: HealthcheckProbe[] = []
  let consecutive = 0
  while (Date.now() < deadline) {
    const at = new Date().toISOString()
    try {
      const resp = await fetchFn(url)
      const ok = healthyStatuses.has(resp.status)
      probes.push({ at, status: resp.status, ok })
      consecutive = ok ? consecutive + 1 : 0
      if (consecutive >= consecutiveRequired) return { passed: true, reason: 'ok', probes }
    } catch (e) {
      probes.push({ at, status: null, ok: false, error: (e as Error).message })
      consecutive = 0
    }
    await sleepFn(intervalMs)
  }
  return {
    passed: false,
    reason: `Healthcheck never reached ${consecutiveRequired} consecutive ${[...healthyStatuses].join('/')} responses within ${totalTimeoutMs}ms`,
    probes,
  }
}

/** Default GitClient that shells out to `git`.  Tests inject a fake. */
export class ShellGitClient implements GitClient {
  constructor(private readonly cwd: string) {}

  async resolveSha(ref: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: this.cwd, timeout: 5000 })
    return stdout.trim()
  }

  async revertMerge(mergeSha: string, opts?: { reason?: string }): Promise<string> {
    const reason = opts?.reason ?? `revert merge ${mergeSha}`
    await execFileAsync('git', ['revert', '--no-edit', '-m', '1', mergeSha], { cwd: this.cwd, timeout: 30_000 })
    if (reason) {
      // Amend the revert commit message with the supplied reason.
      await execFileAsync('git', ['commit', '--amend', '-m', `revert ${mergeSha}\n\n${reason}`], { cwd: this.cwd, timeout: 5000 })
    }
    return this.resolveSha('HEAD')
  }
}
