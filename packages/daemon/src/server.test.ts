import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('createServer', () => {
  it('GET /status returns 200 with expected shape', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; version: string }>()
    expect(body.status).toBe('running')
    expect(body.version).toBe('0.0.1')
  })

  it('GET /missions returns empty array initially', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ missions: unknown[] }>()
    expect(body.missions).toEqual([])
  })

  it('GET /missions/:id returns 404 for unknown id', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /events/stream exists (listen + real fetch + abort)', async () => {
    const app = createServer(db)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as AddressInfo).port
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 80)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/events/stream`, { signal: ac.signal })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    } finally {
      await app.close()
    }
  })
})
