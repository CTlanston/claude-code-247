import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
})
