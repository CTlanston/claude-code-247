import { NdjsonAppender } from './appender.js'
import { NdjsonReader } from './reader.js'
import { fold } from './reducer.js'
import type {
  Event,
  EventId,
  EventInput,
  EventLog as IEventLog,
  Reducer,
} from './types.js'

export interface FileEventLogOpts {
  dir: string
}

/**
 * Default EventLog implementation: NDJSON files under `dir`, monthly shards
 * `events-YYYY-MM.ndjson`. Single-process safe. Multi-process callers should
 * front this with a per-task lock (Stage B+).
 */
export class FileEventLog implements IEventLog {
  private readonly appender: NdjsonAppender
  private readonly reader: NdjsonReader

  constructor(opts: FileEventLogOpts) {
    this.appender = new NdjsonAppender({ dir: opts.dir })
    this.reader = new NdjsonReader({ dir: opts.dir })
  }

  async append(input: EventInput): Promise<EventId> {
    const { id } = await this.appender.append(input)
    return id
  }

  read(taskId: string, fromTs?: string): AsyncIterable<Event> {
    return this.reader.read(taskId, fromTs)
  }

  readAll(fromTs?: string): AsyncIterable<Event> {
    return this.reader.readAll(fromTs)
  }

  async reduce<S>(
    taskId: string,
    initial: S,
    reducer: Reducer<S>,
    fromTs?: string,
  ): Promise<S> {
    return fold(this.read(taskId, fromTs), initial, reducer)
  }
}
