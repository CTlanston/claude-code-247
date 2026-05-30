import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * The single source of truth for the `system.allow_remote_writes` safety gate.
 *
 * Every code path that performs an outward GitHub write (branch push, PR
 * create, PR merge) MUST consult this before acting — see CLAUDE.md
 * non-negotiable #2. Returns true only when explicitly enabled via the
 * `AEDEV_ALLOW_REMOTE_WRITES` env var or an `allow_remote_writes: true` line in
 * one of the known config locations. Default is false (fail-closed).
 */
export function allowRemoteWritesEnabled(stateDir: string): boolean {
  if (process.env['AEDEV_ALLOW_REMOTE_WRITES'] !== undefined) {
    return /^(1|true|yes)$/i.test(process.env['AEDEV_ALLOW_REMOTE_WRITES'])
  }
  const candidates = [
    join(stateDir, 'config.yaml'),
    join(process.env['HOME'] ?? '', '.aedev', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.claude-code-247', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.Codex-247', 'config.yaml'),
  ]
  return candidates.some((path) => {
    try {
      return existsSync(path) && /allow_remote_writes\s*:\s*true/i.test(readFileSync(path, 'utf8'))
    } catch {
      return false
    }
  })
}
