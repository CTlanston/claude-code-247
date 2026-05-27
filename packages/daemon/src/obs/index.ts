// Stage J — Observability triple (SSE + Prometheus + Loki).
export { SseEmitter, type SseSubscriber } from './sse.js'
export { LokiEmitter, type LokiLine, type LokiSink } from './structured-log.js'
export { PromRegistry, registerStandardGauges } from './metrics.js'
export { ObservabilityBus } from './bus.js'
// NEXT-2 Phase L2.2 — alert routes (cost / hold-overrun / redteam-leak / uptime)
export {
  evaluate as evaluateAlerts,
  DEFAULT_ROUTES as DEFAULT_ALERT_ROUTES,
  type AlertRouteId, type AlertSeverity, type AlertRoute,
  type SloSnapshot, type AlertFiring,
} from './alerts.js'
export const OBS_STAGE = 'J' as const
