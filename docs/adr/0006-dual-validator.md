# ADR-0006: Dual External Validator (Gemini + OpenAI)

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

Claude Code is aedev's primary worker. After a worker completes a task, we need
to assess whether the implementation actually satisfies the acceptance criteria
and is safe to merge. The question is: who should do that assessment, and how
trustworthy is the assessment?

**The conflict-of-interest problem:** Having Claude validate its own work is
structurally problematic. A model that produced an incorrect implementation
may also produce an incorrect validation — not through malice, but because
the same reasoning errors that led to the wrong implementation will also lead
to a wrong validation. This is a known problem in LLM self-evaluation: models
tend to agree with themselves.

Additionally, Claude workers may be working from a task plan that itself has
errors or gaps. A Claude validator that sees the same task plan may inherit
the same blind spots.

We evaluated four validation approaches: no validation, rule-based only, single
external model, and dual external models.

---

## Decision

Use two independent external models as validators: Gemini (via the Gemini API)
and OpenAI (via the OpenAI API). Both receive only the evidence bundle (see
`docs/architecture.md` for contents). Neither receives the worker's conversation
transcript, system prompts, or chain-of-thought.

**Validation policy:**
- Both pass: task can auto-advance to merge decision (subject to risk score)
- One passes, one fails: `WAITING` — human approval required regardless of
  risk score
- Both fail: `BLOCKED`
- Either errors (API failure, timeout, malformed response): treated as
  `WAITING` — a validator error is not a pass

The validators run in parallel (both are called concurrently) to minimize
total validation latency.

---

## Alternatives Considered

### 1. No External Validation

**Pros:**
- No API cost for validation
- No external service dependency; system works fully offline
- Simpler architecture

**Cons:**
- The only check on worker output is the test suite and the Reviewer agent
  (which is also Claude). This provides shallow confidence — if the worker
  wrote tests that pass for the wrong reasons, or if the task spec has a gap,
  there is no independent check.
- For auto-merge to be safe at all, there must be at least one check that is
  independent of the worker's reasoning. Without validators, auto-merge is
  limited to trivially low-risk changes with 100% test coverage, which is
  too restrictive to be useful.

### 2. Rule-Based Checker Only

**Pros:**
- Deterministic; the same input always produces the same result
- No API cost; fully offline
- Fast

**Cons:**
- Rule-based checks can only verify structural properties (e.g., "tests were
  run", "diff does not exceed 500 lines", "no forbidden paths touched"). They
  cannot assess semantic correctness — whether the implementation actually
  satisfies the acceptance criteria.
- A rule-based checker would approve a task that passes all tests but
  implements the wrong feature, as long as the structural properties look good.

### 3. Single External Validator (Gemini Only or OpenAI Only)

**Pros:**
- Halves the validation API cost
- Simpler policy (one pass/fail decision instead of two)
- Removes the "validator disagreement" edge case

**Cons:**
- Single point of failure: if the Gemini or OpenAI API is rate-limited,
  temporarily unavailable, or returns an unusually conservative verdict,
  all tasks in the queue are blocked. With two validators, a single API
  outage results in `WAITING` (human approval) rather than full stoppage.
- Lower confidence: a single external validator may have biases or blind spots
  that a second validator would catch. Two independent models that both pass a
  task provide stronger evidence of correctness than one.
- The cost difference between one and two validators is modest: the evidence
  bundle is typically 2–8K tokens. At current API pricing, the cost difference
  per task is a few cents. For a system that is primarily cost-sensitive around
  the primary Claude worker (thousands of tokens per task), validator cost is
  a second-order concern.

### 4. Claude API as Validator

**Pros:**
- Same model family as the worker; may understand Claude Code idioms well
- Single API key to manage

**Cons:**
- This is the structural conflict of interest described in the Context section.
  Even if we use a different Claude model version (e.g., claude-3-5-haiku for
  validation vs. claude-sonnet for workers), the shared training data and
  reasoning patterns mean the validator may have the same systematic errors
  as the worker.
- Anthropic explicitly discourages using Claude to evaluate Claude's own
  outputs in high-stakes settings.
- If Anthropic's API has an outage, both the worker and the validator are
  affected simultaneously — no independent fallback.

---

## Consequences

### Positive

- **Independent review:** Gemini and OpenAI are trained on different data,
  with different architectures and different alignment techniques. A systematic
  error in Claude's reasoning is unlikely to be shared by both Gemini and
  OpenAI simultaneously. Dual agreement provides meaningful confidence that
  the task output is correct.
- **Single-API resilience:** If one validator's API is down or rate-limited,
  the system falls back to `WAITING` (human approval) rather than being
  completely blocked. Tasks can still make progress via human review while
  the API recovers.
- **Disagreement as signal:** When Gemini and OpenAI disagree, that is itself
  useful information — the task is ambiguous or borderline enough that a human
  review is warranted. The disagreement signal is more informative than a
  single validator's uncertain verdict.
- **Separation of concerns:** Validators have a narrow, well-defined interface
  (receive evidence bundle, return structured verdict). Adding a third validator
  or swapping out Gemini for a different model in the future is a contained
  change.

### Negative

- **API cost per task:** Each task run incurs two external API calls for
  validation. At current Gemini and OpenAI pricing, a typical evidence bundle
  (2–8K tokens) costs $0.01–$0.05 per validator per task. This is acceptable
  as a cost-of-quality tradeoff.
- **Two API keys required:** Users must obtain and configure a Gemini API key
  and an OpenAI API key. These are stored in macOS Keychain and referenced
  by name in `config.yaml`. `aedev doctor` checks that both keys are present
  and valid.
- **Validation latency:** Each validator API call takes 5–15 seconds for a
  typical evidence bundle. Running both in parallel means total validation
  latency is ~15 seconds, not the sum. This is acceptable given that the tasks
  themselves take 5–30 minutes.
- **Validator isolation enforcement:** The evidence bundle must be carefully
  constructed to exclude information the validators should not see (worker
  conversation context, system prompts). This is enforced structurally (see
  `docs/security-model.md`), but it is a correctness requirement that must
  be maintained as the evidence bundle format evolves.
