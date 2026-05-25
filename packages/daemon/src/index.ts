/** aedev daemon entry point. */

export const DAEMON_NAME = 'aedev-daemon' as const

/** Default port for the Fastify daemon API. */
export const DEFAULT_PORT = 7247 as const

/** Daemon lifecycle states. */
export type DaemonState = 'starting' | 'running' | 'stopping' | 'stopped'

export { Daemon } from './daemon.js'
export { createServer } from './server.js'
export { HeartbeatService } from './heartbeat.js'
