import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { monotonicFactory } from 'ulid'
import { EventSchema, type Event, type EventId, type EventInput } from './types.js'

const ulid = monotonicFactory()

export function generateEventId(): EventId {
  return `evt_${ulid()}`
}

export function hashIdempotency(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`
}

export function shardFileForTs(dir: string, ts: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ts)
  if (!m) throw new Error(`bad ts: ${ts}`)
  return path.join(dir, `events-${m[1]}-${m[2]}.ndjson`)
}

export interface AppenderOpts {
  dir: string
  /** Optional: a cap on how many recent events to scan for idempotency on init. */
  idemScanLimit?: number
}

/**
 * NDJSON appender with idempotency guard. Single-process safe; uses an
 * in-memory set seeded from the current shard on construction so a restart
 * still rejects duplicate idempotency keys for that month.
 *
 * Cross-month duplicate detection is the reducer's job (a key collision
 * across months is a strong correctness signal — we let it surface).
 */
export class NdjsonAppender {
  private readonly dir: string
  private seen = new Set<string>()
  private hydrated = false

  constructor(opts: AppenderOpts) {
    this.dir = opts.dir
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    if (!this.hydrated) {
      await this.hydrateSeen()
      this.hydrated = true
    }
  }

  async append(input: EventInput): Promise<{ id: EventId; deduped: boolean }> {
    await this.ensure()
    const ts = input.ts ?? new Date().toISOString()
    const id = input.id ?? generateEventId()
    const idempotency =
      input.idempotency ??
      hashIdempotency(
        input.idempotency_source ??
          [input.task_id, input.actor, input.kind, ts, id].join('|'),
      )

    const event: Event = EventSchema.parse({
      id,
      task_id: input.task_id,
      ts,
      actor: input.actor,
      kind: input.kind,
      idempotency,
      payload: input.payload ?? {},
      causation_id: input.causation_id ?? null,
      correlation_id: input.correlation_id ?? input.task_id,
    })

    if (this.seen.has(event.idempotency)) {
      return { id: event.id, deduped: true }
    }

    const file = shardFileForTs(this.dir, event.ts)
    await fs.appendFile(file, JSON.stringify(event) + '\n', 'utf8')
    this.seen.add(event.idempotency)
    return { id: event.id, deduped: false }
  }

  private async hydrateSeen(): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch {
      return
    }
    const files = entries
      .filter((f) => /^events-\d{4}-\d{2}\.ndjson$/.test(f))
      .sort()

    for (const f of files) {
      const text = await fs.readFile(path.join(this.dir, f), 'utf8')
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          const obj = JSON.parse(line) as Event
          if (obj.idempotency) this.seen.add(obj.idempotency)
        } catch {
          // skip malformed line
        }
      }
    }
  }
}
