import type { Event, Reducer } from './types.js'

/**
 * Folds an async iterable of events into a final state.
 *
 * Invariants the reducer harness preserves:
 *  - left-fold determinism: reduce(events) is a pure function of (initial, events, reducer)
 *  - resumability: reduce(reduce(E1), E2) === reduce(E1 ++ E2) for any concat-safe reducer
 *  - replay safety: events are not consumed; the source iterable is read once but the result is reproducible from the same on-disk shards
 */
export async function fold<S>(
  events: AsyncIterable<Event>,
  initial: S,
  reducer: Reducer<S>,
): Promise<S> {
  let state = initial
  for await (const e of events) {
    state = reducer(state, e)
  }
  return state
}

/** Convenience: collect into an array. Useful for tests. */
export async function toArray<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}
