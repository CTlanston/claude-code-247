import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'

/**
 * Stage I — real effect implementations, scoped to safe targets only.
 *
 * Every effect operates on a caller-provided tmp directory or a
 * child process the caller owns. None of these touch ~/.claude-code-247,
 * the daemon process, the actual SQLite file, or any production state.
 *
 * To enable real effects:
 *   const injector = new ChaosInjector({ ..., realEffects: true })
 *   await injector.runOnce('kill_worker') // ← still uses the synthetic
 *                                            //   path; call the real-
 *                                            //   effects fns directly
 *                                            //   from a drill that
 *                                            //   chooses to be real.
 *
 * Why split: the existing ChaosDrill API only emits an event. Real
 * effects need a richer context (a process to kill, a file to lock).
 * The Stage I drills register at the symbolic layer; this module is
 * the optional real-effects sidecar a chaos scheduler can invoke
 * against a sandbox.
 */

export interface KillWorkerArgs {
  /** Path of a node script the chaos run owns. */
  scriptPath: string
  /** Args to pass. */
  args?: string[]
  /** Wait this long for the process to come up, then SIGKILL. */
  liveMs?: number
}

export async function killWorkerEffect(opts: KillWorkerArgs): Promise<{ pid: number; signal: NodeJS.Signals; uptimeMs: number }> {
  const child = spawn('node', [opts.scriptPath, ...(opts.args ?? [])], { detached: false })
  const start = Date.now()
  const live = opts.liveMs ?? 200
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, live)
    child.on('exit', (_code, signal) => {
      clearTimeout(t)
      resolve({ pid: child.pid ?? -1, signal: signal ?? 'SIGKILL', uptimeMs: Date.now() - start })
    })
    child.on('error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

export async function fillDiskEffect(args: { tmpDir: string; sizeBytes: number }): Promise<{ path: string; bytes: number }> {
  await fs.mkdir(args.tmpDir, { recursive: true })
  const p = path.join(args.tmpDir, `chaos-fill-${Date.now()}`)
  const handle = await fs.open(p, 'w')
  try {
    // Write zeros in 64KB chunks
    const CHUNK = 64 * 1024
    const buf = Buffer.alloc(CHUNK, 0)
    let remaining = args.sizeBytes
    while (remaining > 0) {
      const n = Math.min(CHUNK, remaining)
      await handle.write(buf, 0, n)
      remaining -= n
    }
  } finally {
    await handle.close()
  }
  const stat = await fs.stat(p)
  return { path: p, bytes: stat.size }
}

export async function cleanupFillDisk(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true })
}

export interface SqliteLockArgs {
  dbPath: string
  holdMs?: number
}

/**
 * Acquire an exclusive write lock on a SQLite db and hold it for holdMs.
 * Returns an async release function the caller MUST call.
 */
export async function sqliteWriteLockEffect(args: SqliteLockArgs): Promise<{ release: () => void; held: boolean }> {
  const db = new Database(args.dbPath)
  db.pragma('journal_mode = WAL')
  // Start an immediate transaction — blocks subsequent BEGIN IMMEDIATE in other connections.
  db.exec('BEGIN IMMEDIATE')
  let released = false
  const release = () => {
    if (released) return
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    db.close()
    released = true
  }
  if (args.holdMs && args.holdMs > 0) {
    setTimeout(release, args.holdMs).unref()
  }
  return { release, held: true }
}

export interface DropNetworkArgs {
  /** Port to bind a server that refuses every connection — caller uses this URL as a target. */
  port?: number
}

/**
 * Spawn a black-hole TCP server: accepts connections then closes them
 * immediately. Use as a target endpoint for an HTTP client that expects
 * a healthy upstream.
 */
export async function dropNetworkEffect(args: DropNetworkArgs = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = createServer((sock) => {
      sock.destroy()
    })
    srv.once('error', reject)
    srv.listen(args.port ?? 0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        close: () => new Promise((r) => srv.close(() => r())),
      })
    })
  })
}
