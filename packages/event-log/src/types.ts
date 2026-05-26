import { z } from 'zod'

export const KIND_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
export const ID_PATTERN = /^evt_[0-9A-Z]{26}$/
export const IDEM_PATTERN = /^sha256:[0-9a-f]{64}$/

export const EventSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  task_id: z.string().min(1),
  ts: z.string().datetime({ offset: false }),
  actor: z.string().min(1),
  kind: z.string().regex(KIND_PATTERN),
  idempotency: z.string().regex(IDEM_PATTERN),
  payload: z.record(z.unknown()).default({}),
  causation_id: z.string().nullable().optional(),
  correlation_id: z.string().min(1),
})

export type Event = z.infer<typeof EventSchema>
export type EventId = Event['id']

export const EventInputSchema = EventSchema.partial({
  id: true,
  ts: true,
  payload: true,
  correlation_id: true,
}).extend({
  idempotency: z.string().regex(IDEM_PATTERN).optional(),
  idempotency_source: z.string().optional(),
})

export type EventInput = z.input<typeof EventInputSchema>

export type Reducer<S> = (state: S, event: Event) => S

export interface EventLog {
  append(input: EventInput): Promise<EventId>
  read(taskId: string, fromTs?: string): AsyncIterable<Event>
  reduce<S>(taskId: string, initial: S, reducer: Reducer<S>, fromTs?: string): Promise<S>
}
