# Validators

Two evidence-only judges. Default identities (configurable via
`config.yaml → validators.{gemini,openai}.model`):

| Validator | Model | API base |
|---|---|---|
| Gemini | `gemini-2.5-pro` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI | `gpt-5` (configurable) | `OPENAI_BASE_URL` env or `https://api.openai.com/v1` |

## Isolation guarantees

- Each judge gets a fresh process, no conversation context, no
  `--resume`. The Coder's chain-of-thought never reaches them.
- The prompt is built from `validator.judge_contract.evidence_prompt`,
  which composes ONLY:
  - the contract (`.evidence/contract.md`)
  - the Planner's plan
  - the Coder's `worker_done.md`
  - the diff summary
  - the file manifest
  - structured test/lint/build results
  - the risk score
  - the Reviewer's report (if produced)
- No tool access, no file-system reads, no network calls beyond the
  judge API.

## Output schema (strict)

```json
{
  "verdict": "PASS" | "FAIL" | "NEEDS_HUMAN",
  "confidence": 0.0-1.0,
  "summary": "one paragraph",
  "blocking_issues": ["..."],
  "non_blocking_issues": ["..."],
  "evidence_gaps": ["..."],
  "recommended_next_action": "..."
}
```

`normalize_response()` accepts mild coercion (verdict case-insensitive,
confidence clamped to [0,1], list defaults to empty), but **fails
loudly on a missing or invalid verdict** — the merge policy depends on
it.

## Policy

`validator.validation_policy.validate()` runs every enabled judge,
then applies:

- both must PASS, no disagreement, no flagged evidence gaps → eligible
- disagreement → `DISAGREE` → routes to human
- any PASS-with-gap → `NEEDS_HUMAN`
- both NEEDS_HUMAN → `NEEDS_HUMAN`
- both FAIL → `FAIL` (BLOCKED, not human)
- fewer than 2 ran while `require_two_validators: true` → human

## Mock fallback

When the configured API key is missing, the adapter automatically
substitutes `validator.mock_judge`. The validator name in the result
becomes `gemini-mock` / `openai-mock` so the policy layer can tell
real from fake.

`mock_judge` rules:

- contract empty → `NEEDS_HUMAN`
- any test exit != 0 → `FAIL`
- lint failures → `non_blocking_issues`, verdict unaffected
- reviewer marked `NEEDS_HUMAN` → propagate
- otherwise → `PASS` at confidence 0.95

## Adding a third validator

Drop a module under `validator/` exposing a `judge(JudgeInput) ->
JudgeResult`, register it in `validation_policy.validate` (or extend
the function to read a list from config). The agreement rule already
handles N>2 — it requires all enabled judges to PASS.
