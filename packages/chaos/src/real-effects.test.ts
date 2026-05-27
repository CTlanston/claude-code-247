import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { connect, type Socket } from 'node:net'
import Database from 'better-sqlite3'
import {
  killWorkerEffect,
  fillDiskEffect,
  cleanupFillDisk,
  sqliteWriteLockEffect,
  dropNetworkEffect,
} from './index.js'

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'chaos-real-'))
}

describe('chaos · real effects — gated to tmp dirs / spawned children (Stage I L3 substrate)', () => {
  it('case 1: killWorkerEffect actually SIGKILLs a spawned long-lived node child', async () => {
    const dir = await mkTmpDir()
    const script = path.join(dir, 'child.js')
    await fs.writeFile(script, 'setInterval(() => {}, 1000); process.stdout.write("up\\n")', 'utf8')
    const r = await killWorkerEffect({ scriptPath: script, liveMs: 200 })
    expect(r.signal).toBe('SIGKILL')
    expect(r.pid).toBeGreaterThan(0)
    expect(r.uptimeMs).toBeGreaterThanOrEqual(200)
  }, 15_000)

  it('case 2: fillDiskEffect writes the requested size to a tmp file then cleanup removes it', async () => {
    const dir = await mkTmpDir()
    const r = await fillDiskEffect({ tmpDir: dir, sizeBytes: 1024 * 1024 }) // 1 MB
    expect(r.bytes).toBe(1024 * 1024)
    const stat = await fs.stat(r.path)
    expect(stat.size).toBe(1024 * 1024)
    await cleanupFillDisk(r.path)
    await expect(fs.stat(r.path)).rejects.toThrow()
  }, 15_000)

  it('case 3: sqliteWriteLockEffect blocks a second BEGIN IMMEDIATE — release frees it', async () => {
    const dir = await mkTmpDir()
    const dbPath = path.join(dir, 'lock.db')
    new Database(dbPath).exec('CREATE TABLE t (a INTEGER)') // create + auto-close
    const lock = await sqliteWriteLockEffect({ dbPath })
    expect(lock.held).toBe(true)
    // A second connection attempting BEGIN IMMEDIATE should fail SQLITE_BUSY
    const db2 = new Database(dbPath, { timeout: 50 })
    expect(() => db2.exec('BEGIN IMMEDIATE')).toThrow(/busy|locked/i)
    db2.close()
    lock.release()
    // After release a fresh BEGIN IMMEDIATE works
    const db3 = new Database(dbPath)
    db3.exec('BEGIN IMMEDIATE')
    db3.exec('ROLLBACK')
    db3.close()
  }, 15_000)

  it('case 4: dropNetworkEffect black-holes TCP — a client connection is closed immediately', async () => {
    const server = await dropNetworkEffect({})
    expect(server.port).toBeGreaterThan(0)
    const closed = await new Promise<boolean>((resolve) => {
      const s: Socket = connect(server.port, '127.0.0.1', () => undefined)
      let didData = false
      s.on('data', () => { didData = true })
      s.on('close', () => resolve(!didData))
      s.on('error', () => resolve(true))
      setTimeout(() => resolve(false), 1000)
    })
    expect(closed).toBe(true)
    await server.close()
  }, 15_000)
})
