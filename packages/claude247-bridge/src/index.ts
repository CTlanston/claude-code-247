/** TS ↔ Python interop layer for the dual-kernel migration (ADR-0009). */

export const VERSION = '0.0.1' as const

export {
  Claude247Bridge,
} from './bridge.js'
export type {
  Claude247BridgeOptions,
  Claude247EnqueueOptions,
  Claude247EnqueueResult,
  Claude247Task,
  Claude247TaskDetail,
} from './bridge.js'

export {
  Claude247BridgeRunner,
} from './bridge-runner.js'
export type {
  Claude247BridgeRunnerOptions,
} from './bridge-runner.js'
