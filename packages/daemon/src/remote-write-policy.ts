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
  return configCandidates(stateDir).some((path) => {
    try {
      return existsSync(path) && /allow_remote_writes\s*:\s*true/i.test(readFileSync(path, 'utf8'))
    } catch {
      return false
    }
  })
}

/** GR#3 (v4 P4) — the per-repo remote-write whitelist.
 *
 * Reads `AEDEV_REMOTE_WRITE_WHITELIST` (comma-separated repo names) when set,
 * otherwise the `remote_write_whitelist:` list from the known config.yaml
 * locations. Default is EMPTY (fail-closed): with an empty whitelist no repo
 * may receive a push or PR even when `allow_remote_writes` is true. The
 * operator whitelists exactly the safe repos (e.g. `hermus-agent`).
 */
export function remoteWriteWhitelist(stateDir: string): string[] {
  const env = process.env['AEDEV_REMOTE_WRITE_WHITELIST']
  if (env !== undefined) {
    return env.split(',').map((s) => s.trim()).filter(Boolean)
  }
  for (const path of configCandidates(stateDir)) {
    try {
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'utf8')
      const block = text.match(/remote_write_whitelist\s*:\s*\n((?:[ \t]*-[ \t]*.+\n?)*)/)
      if (block?.[1]) {
        const items = [...block[1].matchAll(/-[ \t]*["']?([^"'\n]+?)["']?[ \t]*(?:\n|$)/g)]
          .map((m) => m[1]!.trim())
          .filter(Boolean)
        if (items.length) return items
      }
      const inline = text.match(/remote_write_whitelist\s*:\s*\[([^\]]*)\]/)
      if (inline?.[1] !== undefined) {
        return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      }
    } catch {
      // unreadable config → keep the fail-closed default
    }
  }
  return []
}

function configCandidates(stateDir: string): string[] {
  return [
    join(stateDir, 'config.yaml'),
    join(process.env['HOME'] ?? '', '.aedev', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.claude-code-247', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.Codex-247', 'config.yaml'),
  ]
}
