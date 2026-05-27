import type { Event } from '@aedev/event-log'

export type SseSubscriber = (line: string) => void

/**
 * In-memory SSE emitter — Stage J L1 building block.
 *
 * Real implementation pipes lines to an HTTP response in text/event-stream;
 * tests use the subscribe() API directly.
 */
export class SseEmitter {
  private readonly subs = new Set<SseSubscriber>()

  subscribe(s: SseSubscriber): () => void {
    this.subs.add(s)
    return () => this.subs.delete(s)
  }

  emit(event: Event): void {
    const line = `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
    for (const s of this.subs) s(line)
  }
}
