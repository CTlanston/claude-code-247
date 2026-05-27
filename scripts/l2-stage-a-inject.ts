/**
 * Stage A · L2 reviewer injection script.
 *
 * Proves the on-disk NDJSON log is the source of truth:
 *   1. Build FileEventLog in tmp dir.
 *   2. Append ~10 events for one task.
 *   3. Reduce → snapshot state S1.
 *   4. Back up the shard file(s), delete them, recreate FileEventLog over EMPTY dir.
 *   5. Reduce → expect empty state (proves no hidden cache outside the log).
 *   6. Restore shard files from backup, recreate FileEventLog.
 *   7. Reduce → expect S1 (byte-equal JSON).
 *   8. Pick 3 events; walk causation_id chain to a null root.
 *
 * Run: pnpm tsx scripts/l2-stage-a-inject.ts
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  FileEventLog,
  toArray,
  type Event,
  type Reducer,
} from '../packages/event-log/src/index.js'

interface CountState {
  total: number
  byKind: Record<string, number>
  ids: string[]
}

const reducer: Reducer<CountState> = (s, e) => ({
  total: s.total + 1,
  byKind: { ...s.byKind, [e.kind]: (s.byKind[e.kind] ?? 0) + 1 },
  ids: [...s.ids, e.id],
})

async function listShards(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  return entries.filter((f) => /^events-\d{4}-\d{2}\.ndjson$/.test(f)).sort()
}

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'l2-stage-a-'))
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'l2-stage-a-bk-'))
  const taskId = 'task_l2_review'
  console.log(`[l2] working dir: ${dir}`)
  console.log(`[l2] backup  dir: ${backupDir}`)

  // === Step 1+2: build log and append a chain of ~10 causally-linked events.
  const log = new FileEventLog({ dir })
  const eventIds: string[] = []
  let prev: string | null = null
  const kinds = [
    'task.status.changed',
    'task.run.started',
    'cli.session.probed',
    'hold.policy.created',
    'hold.policy.resolved',
    'approval.request.emitted',
    'approval.decision.received',
    'push.cap.requested',
    'push.cap.allowed',
    'task.run.completed',
  ]
  for (let i = 0; i < 10; i++) {
    const id = await log.append({
      task_id: taskId,
      actor: i === 0 ? 'operator' : 'daemon',
      kind: kinds[i],
      payload: { step: i },
      causation_id: prev,
      idempotency_source: `l2-stage-a-${i}`,
    })
    eventIds.push(id)
    prev = id
  }
  console.log(`[l2] appended ${eventIds.length} events`)

  // === Step 3: reduce → snapshot.
  const s1 = await log.reduce<CountState>(
    taskId,
    { total: 0, byKind: {}, ids: [] },
    reducer,
  )
  console.log(`[l2] S1.total = ${s1.total}, kinds = ${Object.keys(s1.byKind).length}`)

  // === Step 4: back up shard(s), then delete the on-disk shards.
  const shards = await listShards(dir)
  console.log(`[l2] shard files on disk: ${JSON.stringify(shards)}`)
  for (const sf of shards) {
    await fs.copyFile(path.join(dir, sf), path.join(backupDir, sf))
    await fs.unlink(path.join(dir, sf))
  }
  const afterDelete = await listShards(dir)
  if (afterDelete.length !== 0) {
    throw new Error(`expected no shards after delete, got ${afterDelete}`)
  }

  // === Step 5: recreate FileEventLog over the now-empty dir; reduce → expect empty.
  const logEmpty = new FileEventLog({ dir })
  const sEmpty = await logEmpty.reduce<CountState>(
    taskId,
    { total: 0, byKind: {}, ids: [] },
    reducer,
  )
  console.log(`[l2] sEmpty.total = ${sEmpty.total} (expect 0)`)
  if (sEmpty.total !== 0) {
    throw new Error(
      `HIDDEN CACHE: re-created log over empty dir still had ${sEmpty.total} events. ` +
        `The on-disk log is NOT the source of truth.`,
    )
  }

  // === Step 6: restore shard(s) from backup.
  for (const sf of shards) {
    await fs.copyFile(path.join(backupDir, sf), path.join(dir, sf))
  }
  const afterRestore = await listShards(dir)
  if (afterRestore.length !== shards.length) {
    throw new Error(`restore mismatch: ${afterRestore} vs ${shards}`)
  }

  // === Step 7: recreate FileEventLog; reduce → must byte-equal S1.
  const logRestored = new FileEventLog({ dir })
  const s2 = await logRestored.reduce<CountState>(
    taskId,
    { total: 0, byKind: {}, ids: [] },
    reducer,
  )
  const s1json = JSON.stringify(s1)
  const s2json = JSON.stringify(s2)
  const byteEqual = s1json === s2json
  console.log(`[l2] S1 byte-equal S2 ? ${byteEqual}`)
  if (!byteEqual) {
    console.log('--- S1 ---')
    console.log(s1json)
    console.log('--- S2 ---')
    console.log(s2json)
    throw new Error('S1 != S2 after restore')
  }

  // === Step 8: causation chain walk for 3 samples.
  const all = await toArray(logRestored.read(taskId))
  const byId = new Map<string, Event>(all.map((e) => [e.id, e]))
  const samples = [eventIds[0], eventIds[5], eventIds[9]]
  console.log(`[l2] causation traces:`)
  for (const sid of samples) {
    const chain: string[] = []
    let cur: string | null | undefined = sid
    let safety = 0
    while (cur) {
      chain.push(cur)
      const e = byId.get(cur)
      cur = e?.causation_id ?? null
      if (++safety > 100) throw new Error('causation chain runaway')
    }
    const root = byId.get(chain[chain.length - 1])
    const rootIsNull = root && (root.causation_id === null || root.causation_id === undefined)
    console.log(
      `  ${sid} → chain depth ${chain.length} → root ${chain[chain.length - 1]} ` +
        `(causation_id=${root?.causation_id ?? 'null'}, terminates_null=${rootIsNull})`,
    )
    if (!rootIsNull) {
      throw new Error(`sample ${sid} causation chain does not terminate at null`)
    }
  }

  console.log('[l2] PASS — log is source-of-truth, restoration byte-equal, all 3 chains root at null.')

  // cleanup
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(backupDir, { recursive: true, force: true })
}

main().catch((err) => {
  console.error('[l2] FAIL:', err)
  process.exit(1)
})
