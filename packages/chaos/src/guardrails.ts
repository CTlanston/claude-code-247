/** Stage I real-effects guardrails — prevent chaos from touching prod state.
 *
 * The real-effect injectors in real-effects.ts deliberately mutate local
 * state (SIGKILL a child, fill a tmp file, lock a SQLite DB). They are
 * gated through this guardrails layer so the daemon CANNOT accidentally
 * invoke them against `~/.claude-code-247/` or anything production-shaped.
 */

export interface ChaosGuardrails {
  /** Master kill-switch — must be explicitly true for ANY real effect. */
  realEffectsEnabled: boolean
  /**
   * Path prefixes the chaos layer may touch. Real-effect callers pass a
   * target path; it must startWith one of these prefixes. Tmp dirs only
   * by default.
   */
  allowedTargetPrefixes: readonly string[]
  /** Hostnames the chaos layer may attempt network drills against. */
  allowedHostnames: readonly string[]
  /** Pid range — chaos cannot SIGKILL a pid outside this range. The
   *  injector enforces this by only killing children it itself spawned;
   *  this is a belt-and-suspenders check. */
  pidWhitelist?: readonly number[]
}

export const DEFAULT_GUARDRAILS: ChaosGuardrails = {
  realEffectsEnabled: false,
  allowedTargetPrefixes: [
    '/tmp/',
    '/private/tmp/',
    // macOS mkdtemp lands here
    '/var/folders/',
    '/private/var/folders/',
  ],
  allowedHostnames: ['127.0.0.1', 'localhost'],
}

export class GuardrailViolation extends Error {
  constructor(reason: string) {
    super(`chaos guardrail violation: ${reason}`)
    this.name = 'GuardrailViolation'
  }
}

export function assertPathAllowed(p: string, guardrails: ChaosGuardrails): void {
  if (!guardrails.realEffectsEnabled) {
    throw new GuardrailViolation('realEffectsEnabled is false')
  }
  const ok = guardrails.allowedTargetPrefixes.some((prefix) => p.startsWith(prefix))
  if (!ok) {
    throw new GuardrailViolation(`path '${p}' is outside allowedTargetPrefixes`)
  }
  // Extra paranoid: never touch ~/.claude-code-247 even if a prefix did
  // somehow include it.
  const home = process.env.HOME ?? ''
  if (home && p.includes(`${home}/.claude-code-247`)) {
    throw new GuardrailViolation('path targets ~/.claude-code-247 prod state — refused')
  }
}

export function assertHostAllowed(hostOrIp: string, guardrails: ChaosGuardrails): void {
  if (!guardrails.realEffectsEnabled) {
    throw new GuardrailViolation('realEffectsEnabled is false')
  }
  if (!guardrails.allowedHostnames.includes(hostOrIp)) {
    throw new GuardrailViolation(`host '${hostOrIp}' is not in allowedHostnames`)
  }
}

export function assertPidAllowed(pid: number, guardrails: ChaosGuardrails): void {
  if (!guardrails.realEffectsEnabled) {
    throw new GuardrailViolation('realEffectsEnabled is false')
  }
  if (guardrails.pidWhitelist && !guardrails.pidWhitelist.includes(pid)) {
    throw new GuardrailViolation(`pid ${pid} is not in pidWhitelist`)
  }
  if (pid === 1) {
    throw new GuardrailViolation('refused to SIGKILL pid 1 (init)')
  }
  if (pid === process.pid) {
    throw new GuardrailViolation('refused to SIGKILL self')
  }
}
