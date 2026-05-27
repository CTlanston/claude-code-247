import type { Event } from '@aedev/event-log'
import { SseEmitter } from './sse.js'
import { LokiEmitter } from './structured-log.js'
import { PromRegistry, registerStandardGauges } from './metrics.js'

/**
 * ObservabilityBus — Stage J L1.
 *
 * Single fan-out point: ObservabilityBus.dispatch(event) emits to SSE,
 * appends a structured log line via Loki, and updates Prometheus
 * counters/gauges so the same id appears on all three planes.
 */
export class ObservabilityBus {
  readonly sse: SseEmitter
  readonly loki: LokiEmitter
  readonly metrics: PromRegistry
  private readonly counter = 'events_total'

  constructor() {
    this.sse = new SseEmitter()
    this.loki = new LokiEmitter()
    this.metrics = new PromRegistry()
    this.metrics.counter(this.counter, 'Total events fanned out via the observability bus')
    registerStandardGauges(this.metrics)
  }

  dispatch(event: Event): void {
    this.sse.emit(event)
    this.loki.emit(event)
    this.metrics.inc(this.counter, { kind: event.kind })
  }
}
