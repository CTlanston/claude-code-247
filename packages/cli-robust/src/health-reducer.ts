import type { Event, Reducer } from '@aedev/event-log'
import {
  INITIAL_SESSION_HEALTH,
  type SessionHealthState,
} from './types.js'

/**
 * `session_health` view — Stage B.1 reducer.
 *
 * Folds `cli.session.probed` and `cli.session.expired` events into the
 * latest known health snapshot. Pure function of the event stream; no I/O,
 * no clock dependency. This is the reducer GROUND RULE 6 talks about:
 * the view is *always* rebuildable from the log.
 */
export const sessionHealthReducer: Reducer<SessionHealthState> = (s, e) => {
  if (e.kind === 'cli.session.probed') {
    const ok = (e.payload as { ok?: boolean }).ok === true
    if (ok) {
      return {
        ...s,
        lastOkTs: e.ts,
        status: 'healthy',
        probes: s.probes + 1,
      }
    }
    // A probed-but-not-ok event is followed by an .expired in the same tick;
    // we still count it but do not flip status here — the .expired event
    // below is the authoritative status transition.
    return { ...s, probes: s.probes + 1 }
  }
  if (e.kind === 'cli.session.expired') {
    return {
      ...s,
      lastExpiredTs: e.ts,
      status: 'expired',
    }
  }
  return s
}

export { INITIAL_SESSION_HEALTH, type SessionHealthState }

/** Convenience for callers that just want the latest state from an event array. */
export function reduceHealth(events: Event[]): SessionHealthState {
  return events.reduce<SessionHealthState>(sessionHealthReducer, INITIAL_SESSION_HEALTH)
}
