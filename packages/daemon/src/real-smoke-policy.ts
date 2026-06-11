/**
 * CloudHull c1–c4 — pure PASS/FAIL policy for the Operator Cockpit REAL smoke
 * (`scripts/operator-cockpit-real-smoke.ts`).
 *
 * The smoke script needs live `claude` / `codex` / Gemini sessions, so its
 * semantics cannot be CI-proven end to end. Every decision is therefore
 * extracted here as deterministic, unit-tested functions; the script stays a
 * thin impure shell that feeds observations in and reports verdicts out.
 *
 *  - Cycle 1 (mode): STRICT is the default — PASS requires
 *    planner=claude-cli/local_claude_code AND coder=codex-cli/local_codex.
 *    A planner that ran via the honest AEDEV_PLANNER_FALLBACK=codex path
 *    FAILS strict mode with PLANNER_FALLBACK_NOT_ACCEPTED. Only
 *    AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1 accepts the fallback,
 *    and that run is labelled `DEGRADED (planner fallback)` — never a strict
 *    PASS. The report records both the requested and the achieved mode.
 *  - Cycle 2 (validator terminal state): the smoke polls until Gemini reaches
 *    pass / fail / not_configured, or the validator timeout elapses →
 *    GEMINI_TIMEOUT. It never ends on a vague "pending".
 *  - Cycle 3 (regression evidence): success requires ≥1 executed test command
 *    with a PASS signal in the evidence bundle, otherwise
 *    REGRESSION_EVIDENCE_MISSING (same requirement in both modes).
 *  - Cycle 4 (source repo): disposable sandbox by default, or a registered
 *    real repo via AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO (+ _REPO_NAME).
 */

import { basename } from 'path'

// ---------------------------------------------------------------------------
// Cycle 1 — strict vs fallback-proof mode + provider policy
// ---------------------------------------------------------------------------

export const ACCEPT_PLANNER_FALLBACK_ENV = 'AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK'

export type RealSmokeMode = 'strict' | 'fallback-proof'

export type RealSmokeResultLabel = 'PASS (strict)' | 'DEGRADED (planner fallback)' | 'FAIL'

/** STRICT unless AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK is truthy. */
export function resolveRealSmokeMode(env: Record<string, string | undefined> = process.env): RealSmokeMode {
  return /^(1|true|yes)$/i.test((env[ACCEPT_PLANNER_FALLBACK_ENV] ?? '').trim()) ? 'fallback-proof' : 'strict'
}

/** Flattened provider/auth evidence observed from a mission overview. */
export interface ProviderObservation {
  plannerProviders: string[]
  /** True when any planner event carried `planner_provider: 'codex-cli (fallback)'`
   *  (or `fallbackFrom: 'claude-cli'`) — the honest AEDEV_PLANNER_FALLBACK path. */
  plannerFallbackObserved: boolean
  plannerAuthModes: string[]
  workerProviders: string[]
  workerAuthModes: string[]
}

export const EMPTY_PROVIDER_OBSERVATION: ProviderObservation = {
  plannerProviders: [],
  plannerFallbackObserved: false,
  plannerAuthModes: [],
  workerProviders: [],
  workerAuthModes: [],
}

interface OverviewEvent {
  type: string
  entityType?: string | undefined
  payload: Record<string, unknown>
}

const PLANNER_COST_SCOPES = new Set(['planner', 'planner_brainstorm', 'planner_followup'])

/** Build the flattened observation from overview events + secondary evidence
 *  (latest run mode, model-usage.json). Pure: events in, observation out. */
export function buildProviderObservation(
  events: OverviewEvent[],
  extras?: {
    latestRunMode?: string | undefined
    workerUsageProvider?: string | undefined
    workerUsageAuthMode?: string | undefined
  },
): ProviderObservation {
  const plannerEvents = events.filter((e) =>
    (e.type === 'operator.role_done' && e.payload['role'] === 'planner') ||
    (e.type === 'operator.cost_updated' && e.entityType === 'operator_session' && PLANNER_COST_SCOPES.has(String(e.payload['scope']))))
  const workerEvents = events.filter((e) =>
    e.type === 'operator.worker_started' ||
    (e.type === 'operator.cost_updated' && e.entityType === 'mission'))

  const strings = (list: OverviewEvent[], key: string): string[] =>
    [...new Set(list.map((e) => e.payload[key]).filter((v): v is string => typeof v === 'string' && v.length > 0))]

  const workerProviders = new Set(strings(workerEvents, 'provider'))
  if (extras?.latestRunMode) workerProviders.add(extras.latestRunMode)
  if (extras?.workerUsageProvider) workerProviders.add(extras.workerUsageProvider)
  const workerAuthModes = new Set(strings(workerEvents, 'authMode'))
  if (extras?.workerUsageAuthMode) workerAuthModes.add(extras.workerUsageAuthMode)

  return {
    plannerProviders: strings(plannerEvents, 'provider'),
    plannerFallbackObserved: plannerEvents.some((e) =>
      e.payload['planner_provider'] === 'codex-cli (fallback)' || e.payload['fallbackFrom'] === 'claude-cli'),
    plannerAuthModes: strings(plannerEvents, 'authMode'),
    workerProviders: [...workerProviders],
    workerAuthModes: [...workerAuthModes],
  }
}

export interface ModeVerdict {
  requestedMode: RealSmokeMode
  /** What the run actually achieved: `degraded` when the planner ran via the
   *  codex fallback (regardless of whether the requested mode accepts it). */
  achievedMode: 'strict' | 'degraded'
  resultLabel: RealSmokeResultLabel
  failures: string[]
}

const LOCAL_PLANNER_AUTHS = new Set(['local_claude_code', 'local_codex'])

/** Cycle 1 core: provider/auth requirements per mode. Never returns a strict
 *  PASS for a fallback-planned run; strict mode hard-fails on the fallback. */
export function evaluateProviderPolicy(requestedMode: RealSmokeMode, obs: ProviderObservation): ModeVerdict {
  const failures: string[] = []
  const fallback = obs.plannerFallbackObserved ||
    (obs.plannerProviders.includes('codex-cli') && !obs.plannerProviders.includes('claude-cli'))
  const achievedMode: 'strict' | 'degraded' = fallback ? 'degraded' : 'strict'

  if (fallback) {
    if (requestedMode === 'strict') {
      failures.push(
        `PLANNER_FALLBACK_NOT_ACCEPTED: the planner ran via codex-cli (fallback); strict mode requires planner=claude-cli/local_claude_code. ` +
        `Fix the local claude session (claude login / credit), or re-run with ${ACCEPT_PLANNER_FALLBACK_ENV}=1 only if a DEGRADED (planner fallback) run is acceptable.`)
    } else if (obs.plannerAuthModes.length > 0 && !obs.plannerAuthModes.some((m) => LOCAL_PLANNER_AUTHS.has(m))) {
      failures.push(`planner fallback auth was not a local subscription CLI (observed: ${obs.plannerAuthModes.join(', ')})`)
    }
  } else {
    if (!obs.plannerProviders.includes('claude-cli')) {
      failures.push(`planner provider evidence missing or wrong (observed: ${obs.plannerProviders.join(', ') || 'none'}); PASS requires planner=claude-cli`)
    }
    if (obs.plannerAuthModes.length > 0 && !obs.plannerAuthModes.includes('local_claude_code')) {
      failures.push(`planner auth was not local_claude_code (observed: ${obs.plannerAuthModes.join(', ')})`)
    }
  }

  // The coder requirement is identical in both modes: codex-cli on local_codex.
  if (!obs.workerProviders.includes('codex-cli')) {
    failures.push(`coder provider evidence missing or wrong (observed: ${obs.workerProviders.join(', ') || 'none'}); PASS requires coder=codex-cli`)
  }
  if (obs.workerProviders.includes('claude-cli')) {
    failures.push('claude-cli was observed as coder; PASS requires coder=codex-cli')
  }
  if (obs.workerAuthModes.length > 0 && !obs.workerAuthModes.includes('local_codex')) {
    failures.push(`coder auth was not local_codex (observed: ${obs.workerAuthModes.join(', ')})`)
  }

  const resultLabel: RealSmokeResultLabel =
    failures.length > 0 ? 'FAIL' : achievedMode === 'degraded' ? 'DEGRADED (planner fallback)' : 'PASS (strict)'
  return { requestedMode, achievedMode, resultLabel, failures }
}

/** Final label for the report header / exit summary: any failure anywhere is a
 *  FAIL; a clean degraded run stays `DEGRADED (planner fallback)`, never a
 *  strict PASS. `verdict === null` means the run never produced provider
 *  evidence (planner hold / setup error) → FAIL. */
export function finalResultLabel(verdict: ModeVerdict | null, otherFailures: string[]): RealSmokeResultLabel {
  if (!verdict || verdict.failures.length > 0 || otherFailures.length > 0) return 'FAIL'
  return verdict.resultLabel
}

// ---------------------------------------------------------------------------
// Cycle 2 — Gemini terminal state
// ---------------------------------------------------------------------------

export const VALIDATOR_TIMEOUT_ENV = 'AEDEV_COCKPIT_REAL_SMOKE_VALIDATOR_TIMEOUT_MS'
export const DEFAULT_VALIDATOR_TIMEOUT_MS = 180_000

export type ValidatorTerminal = 'pass' | 'fail' | 'not_configured'
/** Terminal states plus the smoke-level timeout outcome. */
export type ValidatorOutcome = ValidatorTerminal | 'timeout'

/** Resolve a mission overview snapshot to a TERMINAL validator state, or null
 *  while validation is still pending (keep polling). */
export function resolveValidatorTerminal(overview: {
  validatorStatus?: string | undefined
  validators: Array<{ validator: string; verdict: string }>
}): ValidatorTerminal | null {
  if (overview.validators.length > 0) {
    return overview.validators.every((v) => v.verdict === 'pass') ? 'pass' : 'fail'
  }
  if (overview.validatorStatus === 'not_configured') return 'not_configured'
  return null
}

/** Distinct failure line for a validator outcome, or null when acceptable.
 *  `not_configured` is honest (no key) and acceptable unless the caller
 *  requires a Gemini PASS. Timeout is never reported as vague "pending". */
export function validatorFailure(outcome: ValidatorOutcome, opts: { requireGeminiPass: boolean; timeoutMs: number }): string | null {
  if (outcome === 'timeout') {
    return `GEMINI_TIMEOUT: validator did not reach a terminal state (pass/fail/not_configured) within ${opts.timeoutMs}ms — raise ${VALIDATOR_TIMEOUT_ENV} or check the Gemini key/quota`
  }
  if (outcome === 'fail') {
    return 'GEMINI_FAIL: a configured validator returned a non-pass verdict on the evidence bundle'
  }
  if (outcome === 'not_configured' && opts.requireGeminiPass) {
    return 'GEMINI_NOT_CONFIGURED: a Gemini PASS was required for this run but no validator is configured'
  }
  return null
}

/** Expected create-pr block code for a validator outcome (remote writes are
 *  off in the smoke, so even a PASS must be blocked by the remote-write gate).
 *  Null → assert only that the PR is blocked, not the exact code. */
export function expectedPrBlockCode(outcome: ValidatorOutcome | null): 'REMOTE_WRITES_DISABLED' | 'GEMINI_NOT_PASS' | 'GEMINI_NOT_CONFIGURED' | null {
  if (outcome === 'pass') return 'REMOTE_WRITES_DISABLED'
  if (outcome === 'fail') return 'GEMINI_NOT_PASS'
  if (outcome === 'not_configured') return 'GEMINI_NOT_CONFIGURED'
  return null
}

// ---------------------------------------------------------------------------
// Cycle 3 — required regression evidence
// ---------------------------------------------------------------------------

export const REGRESSION_EVIDENCE_MISSING = 'REGRESSION_EVIDENCE_MISSING'

export interface RegressionCommand {
  command: string
  passed: boolean
  source: string
  detail: string
}

export interface RegressionEvidence {
  /** True when ≥1 executed test command with a PASS signal was found. */
  ok: boolean
  commands: RegressionCommand[]
  /** REGRESSION_EVIDENCE_MISSING reason when not ok. */
  reason: string | null
}

/** Recognized test-runner invocations. Deliberately conservative: a bare
 *  mention of "tests" never counts — only an actual command. */
const TEST_COMMAND_RE =
  /\b(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+test\b[^"`\n\\]*|\bnpx\s+(?:vitest|jest|mocha)\b[^"`\n\\]*|\bvitest(?:\s+run)?\b[^"`\n\\]*|\bpytest\b[^"`\n\\]*|\bgo\s+test\b[^"`\n\\]*|\bcargo\s+test\b[^"`\n\\]*|\bnode\s+(?:--test\b|\S*test\S*)[^"`\n\\]*/i

const PASS_SIGNAL_RE =
  /\bexit(?:[ _-]?code)?\s*[:=]?\s*0\b|->\s*exit\s+0\b|\b[0-9]+\s+pass(?:ed|ing)?\b|\bPASS(?:ED)?\b|\ball\s+tests?\s+pass(?:ed)?\b|\btests?\s+pass(?:ed)?\b/i

function stripZeroFailures(line: string): string {
  return line.replace(/\b0\s+fail(?:ed|ures?|ing)?\b|\bfail(?:ed|ures?)?\s*[:=]\s*0\b/gi, '')
}

function hasFailSignal(line: string): boolean {
  return /\bfail(?:s|ed|ing|ure|ures)?\b|\bexit(?:[ _-]?code)?\s*[:=]?\s*[1-9]\d*\b|->\s*exit\s+[1-9]\d*\b/i.test(stripZeroFailures(line))
}

/**
 * Parse evidence file contents (test-summary.md, transcript-summary.md,
 * done-report.md, operator-run.log, …) for executed test commands and their
 * PASS/FAIL outcome. Recognizes three honest shapes:
 *   1. The docker runner's "Runner-verified tests: `cmd` -> exit N" line.
 *   2. Codex `command_execution` JSON log lines with `"exit_code": N`.
 *   3. Markdown/report lines naming a test command together with an explicit
 *      pass/fail signal on the same line.
 */
export function parseRegressionEvidence(files: Record<string, string>): RegressionEvidence {
  const commands: RegressionCommand[] = []

  for (const [source, content] of Object.entries(files)) {
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue

      // Shape 1: runner-verified re-run (claude-docker P6 path).
      const verified = line.match(/Runner-verified tests: `([^`]+)` -> exit (\d+)(.*)$/)
      if (verified) {
        const exit = Number(verified[2])
        const rest = verified[3] ?? ''
        commands.push({
          command: verified[1] ?? '',
          passed: exit === 0 && !/[1-9]\d*\s+failed/.test(rest),
          source,
          detail: line,
        })
        continue
      }

      // Shape 2: codex command_execution JSON events in operator-run.log.
      if (line.includes('"command_execution"')) {
        const cmd = line.match(/"command":"((?:[^"\\]|\\.)*)"/)?.[1]
        const exit = line.match(/"exit_code":\s*(-?\d+)/)?.[1]
        if (cmd && exit !== undefined && TEST_COMMAND_RE.test(cmd.replace(/\\"/g, '"'))) {
          commands.push({
            command: cmd.replace(/\\"/g, '"'),
            passed: Number(exit) === 0,
            source,
            detail: `command_execution exit_code=${exit}`,
          })
        }
        continue
      }

      // Shape 3: report lines naming a test command with an explicit outcome.
      const cmdMatch = line.match(TEST_COMMAND_RE)
      if (!cmdMatch) continue
      if (hasFailSignal(line)) {
        commands.push({ command: cmdMatch[0].trim(), passed: false, source, detail: line })
      } else if (PASS_SIGNAL_RE.test(stripZeroFailures(line))) {
        commands.push({ command: cmdMatch[0].trim(), passed: true, source, detail: line })
      }
    }
  }

  if (commands.some((c) => c.passed)) return { ok: true, commands, reason: null }
  const scanned = Object.keys(files).join(', ') || '(no evidence files)'
  const reason = commands.length === 0
    ? `${REGRESSION_EVIDENCE_MISSING}: no executed test command with a result was found in evidence (scanned: ${scanned})`
    : `${REGRESSION_EVIDENCE_MISSING}: test command(s) executed but none passed: ${commands.map((c) => `${c.command} [${c.source}]`).join('; ')}`
  return { ok: false, commands, reason }
}

// ---------------------------------------------------------------------------
// Cycle 4 — sandbox vs registered source repo
// ---------------------------------------------------------------------------

export const SOURCE_REPO_ENV = 'AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO'
export const REPO_NAME_ENV = 'AEDEV_COCKPIT_REAL_SMOKE_REPO_NAME'

export type SourceRepoChoice =
  | { kind: 'sandbox' }
  | { kind: 'registered'; path: string; name: string }

/** Resolve the env contract: default sandbox; SOURCE_REPO(+REPO_NAME) selects
 *  a registered real repo. A name without a path is a clear setup error —
 *  never a silently faked sandbox run. Git validation stays in the script. */
export function resolveSourceRepoChoice(
  env: Record<string, string | undefined> = process.env,
): { ok: true; choice: SourceRepoChoice } | { ok: false; error: string } {
  const path = (env[SOURCE_REPO_ENV] ?? '').trim()
  const name = (env[REPO_NAME_ENV] ?? '').trim()
  if (!path) {
    if (name) {
      return { ok: false, error: `${REPO_NAME_ENV}=${name} is set but ${SOURCE_REPO_ENV} is empty — set the repo path or unset the name` }
    }
    return { ok: true, choice: { kind: 'sandbox' } }
  }
  return { ok: true, choice: { kind: 'registered', path, name: name || basename(path) } }
}

/** Report string for which repo path the run used. */
export function describeRepoSource(choice: SourceRepoChoice): string {
  return choice.kind === 'sandbox' ? 'sandbox' : `registered:${choice.name} (${choice.path})`
}
