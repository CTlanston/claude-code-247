/**
 * E2E-2 L3 shadow walk — automated stand-in for the operator cockpit walk.
 *
 * Injects a deliberately ambiguous mission (no verifiable acceptance criteria,
 * vague wording, no target, unbounded scope) into a real IntakeService wired
 * with the ClarificationGate, and proves ADR-0020's contract from runtime
 * evidence:
 *   - the gate INTERCEPTS (mission.clarification.requested emitted)
 *   - NO LLM token spend (deterministic scorer — model_usage stays empty)
 *   - <= max_questions (4) structured questions
 *   - answering produces a verifiable clarified-spec.md + mission.clarification.resolved
 *   - a CLEAR mission is NOT gated (no over-gating)
 *
 * No network, no API keys, no remote writes — pure local deterministic logic.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { IntakeService, ClarificationGate, type ClarificationAnswer } from '@aedev/daemon'

const fail: string[] = []
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${msg}`)
  if (!cond) fail.push(msg)
}

function main(): void {
  const stateDir = mkdtempSync(join(tmpdir(), 'e2e2-shadow-'))
  const db = new AedevDb(':memory:')
  try {
    const repo = db.insertRepo({
      name: 'shadow', path: stateDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const gate = new ClarificationGate(db, stateDir)
    const intake = new IntakeService(db, stateDir, gate)

    // --- Ambiguous mission: should be intercepted ---
    const ambiguousDesc = 'improve everything and make the whole app better, polish various stuff'
    console.log(`\n=== Ambiguous mission: "${ambiguousDesc}" ===`)
    const m = intake.createMissionCandidate(repo.id, ambiguousDesc)

    const requested = db.queryEvents({ type: 'mission.clarification.requested', entityId: m.id })
    check(requested.length === 1, 'gate intercepted: exactly one mission.clarification.requested event')
    check(intake.needsClarification(m.id), 'needsClarification(mission) === true')

    const qCount = Number(requested[0]?.payload['questionCount'] ?? -1)
    check(qCount >= 1, `>=1 structured question asked (got ${qCount})`)
    check(qCount <= 4, `<=4 questions per ADR-0020 max_questions (got ${qCount})`)

    // No LLM token spend — the scorer is deterministic.
    check(db.listModelUsage().length === 0, 'no LLM token spend (model_usage empty)')

    // --- Answer the questions → resolve → verifiable clarified-spec.md ---
    const evaluation = gate.evaluate({ title: m.title, description: ambiguousDesc }, intake.getDesign(m.id))
    const answers: ClarificationAnswer[] = evaluation.questions.map((q) => ({
      questionId: q.id, field: q.field, answer: `operator chose: ${q.recommendedDefault}`,
    }))
    const specPath = gate.resolve(m.id, evaluation.questions, answers)

    const resolved = db.queryEvents({ type: 'mission.clarification.resolved', entityId: m.id })
    check(resolved.length === 1, 'answering emitted exactly one mission.clarification.resolved event')
    check(existsSync(specPath), `clarified-spec.md written at ${specPath}`)
    const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
    check(spec.includes('Verifiable acceptance criteria'), 'clarified-spec.md has a Verifiable acceptance criteria section')
    check(gate.status(m.id) === 'resolved', 'gate.status(mission) === resolved')

    // --- Clear mission: must NOT be gated (no over-gating) ---
    const clearDesc = 'Add a "## Running the tests" section to README.md documenting the `node tests/run.js` command'
    console.log(`\n=== Clear mission: "${clearDesc}" ===`)
    const m2 = intake.createMissionCandidate(repo.id, clearDesc)
    check(db.queryEvents({ type: 'mission.clarification.requested', entityId: m2.id }).length === 0,
      'clear mission NOT gated (no clarification.requested event)')
    check(!intake.needsClarification(m2.id), 'clear mission needsClarification === false')

    console.log('\n--- clarified-spec.md (excerpt) ---')
    console.log(spec.split('\n').slice(0, 14).join('\n'))

    console.log(`\n=== SHADOW WALK ${fail.length === 0 ? 'PASS' : 'FAIL'} (${fail.length} failure(s)) ===`)
    if (fail.length > 0) process.exitCode = 1
  } finally {
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

main()
