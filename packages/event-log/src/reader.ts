import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { EventSchema, type Event } from './types.js'

export interface ReaderOpts {
  dir: string
}

export class NdjsonReader {
  private readonly dir: string

  constructor(opts: ReaderOpts) {
    this.dir = opts.dir
  }

  /**
   * Yields events for a task in chronological order, walking monthly shards.
   * fromTs filters events strictly >= fromTs.
   */
  async *read(taskId: string, fromTs?: string): AsyncIterable<Event> {
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
        let event: Event
        try {
          event = EventSchema.parse(JSON.parse(line))
        } catch {
          continue
        }
        if (event.task_id !== taskId) continue
        if (fromTs && event.ts < fromTs) continue
        yield event
      }
    }
  }

  /** All events across tasks, used by reducers that watch system-level state. */
  async *readAll(fromTs?: string): AsyncIterable<Event> {
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
        let event: Event
        try {
          event = EventSchema.parse(JSON.parse(line))
        } catch {
          continue
        }
        if (fromTs && event.ts < fromTs) continue
        yield event
      }
    }
  }
}
