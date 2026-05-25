/** aedev CLI entry point. */

export const CLI_NAME = 'aedev' as const
export const CLI_VERSION = '0.0.1' as const

/** Top-level CLI commands. */
export type CliCommand =
  | 'init'
  | 'daemon'
  | 'repo'
  | 'mission'
  | 'task'
  | 'intake'
  | 'dashboard'
  | 'status'
  | 'secret'

export { createCli } from './cli.js'
