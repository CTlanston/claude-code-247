import type { Event } from '@aedev/event-log'

export interface LokiLine {
  /** Loki-style stream labels. */
  stream: Record<string, string>
  /** Iso ts + JSON body. */
  values: [string, string][]
}

export type LokiSink = (line: LokiLine) => void

/**
 * Loki-style structured log emitter — Stage J L1.
 *
 * Each event becomes a single Loki line with the event id preserved in
 * the JSON body so a downstream grep can correlate with SSE / metrics.
 */
export class LokiEmitter {
  private readonly sinks: LokiSink[] = []

  attach(sink: LokiSink): () => void {
    this.sinks.push(sink)
    return () => {
      const i = this.sinks.indexOf(sink)
      if (i >= 0) this.sinks.splice(i, 1)
    }
  }

  emit(event: Event): void {
    const line: LokiLine = {
      stream: { actor: event.actor, kind: event.kind },
      values: [[event.ts, JSON.stringify({ id: event.id, ...event })]],
    }
    for (const s of this.sinks) s(line)
  }
}
