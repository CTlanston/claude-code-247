import { describe, it, expect } from 'vitest'
import {
  PLANNER_AUTH_HOLD_CODE,
  PLANNER_FALLBACK_ENV,
  detectPlannerAuthFailure,
  plannerFallbackProvider,
} from './planner-auth.js'

// overnight-p1 — the operator's real failure: `claude -p` returns 401
// (subscription/Agent-SDK auth) and the cockpit used to raise a confusing
// generic HOLD-PLANNER-CLI. These pure helpers classify the failure and read
// the explicit opt-in fallback policy. NEVER a paid-API fallback.

describe('detectPlannerAuthFailure', () => {
  it('classifies a 401 stderr as an auth failure with the matched hint', () => {
    const hit = detectPlannerAuthFailure({
      exitCode: 1,
      error: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
    })
    expect(hit).not.toBeNull()
    expect(hit!.matched).toBe('401')
  })

  it('classifies unauthorized / login / credit hints (case-insensitive)', () => {
    expect(detectPlannerAuthFailure({ exitCode: 1, error: 'Unauthorized request' })!.matched.toLowerCase()).toBe('unauthorized')
    expect(detectPlannerAuthFailure({ exitCode: 2, transcript: 'Please run /login to continue' })!.matched.toLowerCase()).toBe('login')
    expect(detectPlannerAuthFailure({ exitCode: 1, error: 'You are out of credit for this billing period' })!.matched.toLowerCase()).toBe('credit')
  })

  it('matches the hint in the transcript when stderr is empty', () => {
    const hit = detectPlannerAuthFailure({ exitCode: 1, transcript: 'authentication_error: token invalid' })
    expect(hit).not.toBeNull()
  })

  it('a SUCCESSFUL run is never an auth failure even if the text mentions 401', () => {
    expect(detectPlannerAuthFailure({ exitCode: 0, transcript: 'Here is how to handle HTTP 401 in your app' })).toBeNull()
  })

  it('a failure without any auth hint is NOT classified as auth', () => {
    expect(detectPlannerAuthFailure({ exitCode: -1, error: 'spawn failed: ENOENT' })).toBeNull()
    expect(detectPlannerAuthFailure({ exitCode: 124 })).toBeNull()
  })

  it('exports the distinct hold code', () => {
    expect(PLANNER_AUTH_HOLD_CODE).toBe('HOLD-PLANNER-AUTH')
  })
})

describe('plannerFallbackProvider — explicit opt-in only', () => {
  it('default (env unset) → null: no fallback, claude-only planner pin holds', () => {
    expect(plannerFallbackProvider({})).toBeNull()
  })

  it('AEDEV_PLANNER_FALLBACK=codex → codex (trimmed, case-insensitive)', () => {
    expect(plannerFallbackProvider({ [PLANNER_FALLBACK_ENV]: 'codex' })).toBe('codex')
    expect(plannerFallbackProvider({ [PLANNER_FALLBACK_ENV]: ' CODEX ' })).toBe('codex')
  })

  it('any other value → null (no silent API fallback, no other providers)', () => {
    for (const v of ['1', 'true', 'claude', 'openai', 'anthropic-api', '']) {
      expect(plannerFallbackProvider({ [PLANNER_FALLBACK_ENV]: v })).toBeNull()
    }
  })
})
