import { describe, it, expect } from 'vitest'
import type { Event } from '@aedev/event-log'
import { ObservabilityBus, registerStandardGauges, PromRegistry } from './index.js'

function fakeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt_01KSHV4TGJAWGB1TZDGR9AS6RE',
    task_id: 'task_j',
    ts: '2026-05-27T01:00:00.000Z',
    actor: 'daemon.test',
    kind: 'task.run.started',
    idempotency: 'sha256:' + 'a'.repeat(64),
    payload: {},
    causation_id: null,
    correlation_id: 'task_j',
    ...overrides,
  }
}

describe('obs · observability bus (Stage J L1)', () => {
  it('case 1: dispatching one event appears on all three planes with same id', () => {
    const bus = new ObservabilityBus()
    const sseLines: string[] = []
    const lokiLines: string[] = []
    bus.sse.subscribe((l) => sseLines.push(l))
    bus.loki.attach((l) => lokiLines.push(l.values[0][1]))
    const e = fakeEvent()
    bus.dispatch(e)

    expect(sseLines[0]).toContain(`id: ${e.id}`)
    expect(lokiLines[0]).toContain(`"id":"${e.id}"`)
    expect(bus.metrics.render()).toContain(`events_total{kind="task.run.started"} 1`)
  })

  it('case 2: 100 events do not lose any across the three planes', () => {
    const bus = new ObservabilityBus()
    let sseN = 0
    let lokiN = 0
    bus.sse.subscribe(() => { sseN++ })
    bus.loki.attach(() => { lokiN++ })
    for (let i = 0; i < 100; i++) {
      const e = fakeEvent({ id: `evt_01KSHV4TGJAWGB1TZDGR9AS${String(i).padStart(4, '0').padEnd(4, '0')}` })
      bus.dispatch(e)
    }
    expect(sseN).toBe(100)
    expect(lokiN).toBe(100)
    // 100 events of same kind → counter should be 100
    expect(bus.metrics.render()).toMatch(/events_total\{[^}]*\} 100/)
  })

  it('case 3: SSE format is text/event-stream compatible', () => {
    const bus = new ObservabilityBus()
    let captured = ''
    bus.sse.subscribe((l) => { captured = l })
    bus.dispatch(fakeEvent({ kind: 'hold.policy.created' }))
    expect(captured).toMatch(/^id: /m)
    expect(captured).toMatch(/^event: hold\.policy\.created/m)
    expect(captured).toMatch(/^data: \{/m)
    expect(captured.endsWith('\n\n')).toBe(true)
  })

  it('case 4: standard gauges all registered', () => {
    const reg = new PromRegistry()
    registerStandardGauges(reg)
    const text = reg.render()
    for (const g of ['holds_open', 'approval_pending', 'session_health', 'subscription_calls_24h', 'moves_in_flight']) {
      expect(text).toContain(`# TYPE ${g} gauge`)
    }
  })

  it('case 5: counter increments aggregate per label (kind)', () => {
    const bus = new ObservabilityBus()
    bus.dispatch(fakeEvent({ kind: 'task.run.started' }))
    bus.dispatch(fakeEvent({ kind: 'task.run.completed' }))
    bus.dispatch(fakeEvent({ kind: 'task.run.started' }))
    const text = bus.metrics.render()
    expect(text).toContain('events_total{kind="task.run.started"} 2')
    expect(text).toContain('events_total{kind="task.run.completed"} 1')
  })

  it('case 6: same event id present in SSE + Loki + (implicitly) metrics counter', () => {
    const bus = new ObservabilityBus()
    let sse = ''
    let loki = ''
    bus.sse.subscribe((l) => { sse = l })
    bus.loki.attach((l) => { loki = l.values[0][1] })
    const e = fakeEvent({ id: 'evt_01KSHV4TGJAWGB1TZDGR9AS6XX' })
    bus.dispatch(e)
    expect(sse).toContain(e.id)
    expect(loki).toContain(e.id)
  })
})
