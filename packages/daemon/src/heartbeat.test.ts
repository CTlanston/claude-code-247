import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { HeartbeatService } from './heartbeat.js'

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('HeartbeatService', () => {
  it('writes a heartbeat event immediately on start', async () => {
    const hb = new HeartbeatService(db, 60_000)
    hb.start()
    const events = db.queryEvents({ type: 'heartbeat' })
    expect(events.length).toBeGreaterThanOrEqual(1)
    hb.stop()
  })

  it('getLastHeartbeat returns the most recent event', () => {
    const hb = new HeartbeatService(db, 60_000)
    hb.start()
    const last = hb.getLastHeartbeat()
    expect(last).toBeDefined()
    expect(last?.type).toBe('heartbeat')
    hb.stop()
  })
})
