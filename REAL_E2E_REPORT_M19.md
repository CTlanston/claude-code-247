# REAL_E2E_REPORT_M19.md — third live E2E, BR-001/2/3 in production

> Goal (per M19 directive Phase 5): run a third real task against
> `CTlanston/auto-evo-playground` to exercise the BR-001/2/3 fixes
> end-to-end. Worker uses the local `claude` CLI (subscription);
> `ANTHROPIC_API_KEY` not in scope.

## TL;DR

- **Pipeline ran cleanly start-to-finish.** Worker produced a correct
  `dedupe_words` implementation + 7 tests. 86 pytest assertions
  passed in the workspace (was 79).
- **BR-001 fired in production** — `diff_body_safe.md` was produced.
  But the body was REDACTED because `orchestrator/secret_scanner.py`'s
  `env_var_assign` regex hit on the **variable name `tokens`** in
  the implementation (a false positive — see Finding M19-F1).
- **BR-002 confirmed working** — `GEMINI_API_KEY` was loaded from
  `~/.claude-code-247/.env` by the env_loader chain, so the real
  Gemini judge ran (`gemini` validator, not mock).
- **BR-003 confirmed working** — 3 worker_exits rows written, all
  `tests` phase, all `success`. CLI `claude247 worker-exits --task ...`
  returns the rows.
- **M18-P1 invariant held** — `openai-mock` propagated `NEEDS_HUMAN`,
  Gemini returned `NEEDS_HUMAN` (correctly, because of the redacted
  body), merge policy routed to `WAITING_APPROVAL`.
- **Worker auth mode: local Claude Code. Anthropic spend: $0.00.**

## Setup

| Item | Value |
|---|---|
| Target repo | `CTlanston/auto-evo-playground` (sacrificial) |
| Worker | local `claude` CLI 2.1.142 (subscription auth) |
| `auth.worker_mode` | `local_claude_code` (M18-P0) |
| `ANTHROPIC_API_KEY` | not in shell; stripped from worker env by `effective_env` |
| Validators | Gemini **real** (key in `~/.claude-code-247/.env`, picked up by BR-002 chain) + OpenAI **mock** (no `OPENAI_API_KEY`) |
| `validators.allow_mock_validators_for_auto_merge` | `false` (M18-P1) |
| Task | `dedupe_words(text: str) -> str` per M19 directive Phase 5 |

## Run

```
$ claude247 start --repo auto-evo-playground --goal "Add dedupe_words..." --json
{"command_id":"cmd_01KSDR19THEFXGJTC127M0T91M","status":"queued",
 "queued_at":"2026-05-24T19:40:18.641Z"}

$ claude247 dispatcher --once
handled start_task (cmd_01KSDR19THEFXGJTC127M0T91M) → succeeded
```

A single `dispatcher --once` drained the queue and walked the full
pipeline: workspace → planner → coder → reviewer → diff →
diff_body_safe → file_manifest → coverage → risk → validators →
merge_policy → commit → push → PR.

Timeline (from `claude247 task ...`):
```
2026-05-24T19:40:22.416Z  created                  task created from cli
2026-05-24T19:40:22.820Z  planning                 prepare_workspace + worker
2026-05-24T19:44:00.678Z  validating               validators on .evidence/
2026-05-24T19:44:16.911Z  pr_created               ruling: waiting_approval
2026-05-24T19:44:16.913Z  waiting_for_approval     validators: NEEDS_HUMAN
```

End-to-end wall clock: ~3m 54s (queued at 19:40:18, terminal state at 19:44:16).

## Results

| Item | Value |
|---|---|
| `task_id` | `task_01KSDR1DGG4DV8XNGZSR7506QC` |
| `repo_id` | `auto-evo-playground` |
| Branch | `agent/auto-evo-playground/task_01KSDR1DGG4DV8XNGZSR7506QC/add-dedupe-words-text-str-str-to-src-str` |
| PR | [auto-evo-playground#54](https://github.com/CTlanston/auto-evo-playground/pull/54) (draft, pending approval) |
| Commit SHA | `9d63264` |
| Files changed | `src/string_utils.py` (+22), `tests/test_string_utils.py` (+53 / -1) |
| Workspace pytest | 86 passing (was 79, +7 new `dedupe_words` tests) |
| `diff_body_safe.md` produced | **YES** (REDACTED — see Finding M19-F1) |
| `diff_body_metadata.json` produced | **YES** |
| Validator inputs included diff body | **YES** (rendered with BLOCKED warning per BR-001 §Security rule) |
| Gemini verdict | `NEEDS_HUMAN`, confidence **0.1** — real call, real model (`gemini` validator label, not `gemini-mock`). Honest reasoning: "the diff body has been redacted due to the detection of secret-like content. Without access to the code, it is impossible to verify that the new function's behavior correctly implements the 12 specific criteria defined in the contract." |
| OpenAI verdict | `NEEDS_HUMAN`, confidence 0.7 — `openai-mock` (no OPENAI_API_KEY); reviewer-escalated |
| Risk score | 0 (low) |
| Merge decision | `WAITING_APPROVAL` (M18-P1 gate: mock validator can't auto-merge) |
| Worker auth mode | `local_claude_code` |
| Anthropic API spend | **$0.00** (worker invoked local CLI; ANTHROPIC_API_KEY stripped from env) |
| `worker_exits` count | **3** (all `tests` phase, all `success`, exit=0) |
| Memory result | (entries written via memory_compiler — not verified field by field here) |
| Replay result | replays/ dir contains the run snapshot (default behavior) |

## Worker implementation (from `git show HEAD:src/string_utils.py`)

```python
def dedupe_words(text: str) -> str:
    """Remove consecutive duplicate words from ``text``.

    Words are compared case-insensitively (via ``casefold``) but the
    casing of the first occurrence in each run is preserved. Runs of
    whitespace collapse to a single space; leading and trailing
    whitespace is removed. Returns ``""`` for empty or whitespace-only
    input. Punctuation is treated as part of the adjacent word.
    """
    tokens = text.split()
    if not tokens:
        return ""
    out = [tokens[0]]
    prev_key = tokens[0].casefold()
    for tok in tokens[1:]:
        key = tok.casefold()
        if key != prev_key:
            out.append(tok)
            prev_key = key
    return " ".join(out)
```

Functionally correct (`casefold` for unicode-safe comparison; first
occurrence preserved; consecutive-only dedup; whitespace collapse;
empty handling; punctuation included as part of token). 7 unit tests
shipped alongside, all passing.

## Mocked vs real this run

| Component | Mode |
|---|---|
| Claude Code worker | **real** (subscription, local CLI) |
| Gemini 2.5 Pro | **real** (BR-002 env_loader picked up `GEMINI_API_KEY` from `~/.claude-code-247/.env`) |
| OpenAI validator | mock (no `OPENAI_API_KEY` in env) |
| GitHub push + PR | **real** |
| Auto-merge | **not exercised** (per M18-P1, mock validators correctly held the gate) |
| Memory + replay | **real** (writes to `~/.claude-code-247/state/claude247.db` + `replays/`) |
| Docker runner | local subprocess (Docker daemon offline — known) |

## Findings

### Finding M19-F1 (new): `secret_scanner.env_var_assign` regex is too loose

The `env_var_assign` pattern in `orchestrator/secret_scanner.py` is:

```regex
(?im)^[+\s]*(SECRET|API_KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+
```

Because of the `(?i)` flag, it matches case-insensitively. So the
ordinary Python line `+    tokens = text.split()` matches: the
substring `tokens` is `TOKEN` + `s` (where `s` is accepted by the
case-insensitive `[A-Z0-9_]*`), and ` = text.split()` matches
`\s*=\s*\S+`.

Result: any Python code that introduces a lowercase variable name
starting with `token`, `secret`, or `password` will be flagged as
secret-like, the safe diff body will be redacted to a summary, and
validators will be forced into NEEDS_HUMAN.

This is real BR-001 production behavior (the security rule worked as
designed); the upstream regex was too loose.

**Severity**: high — high false-positive rate on legitimate code; caps
real-validator PASS rate even when the diff is clean.

**Recommended fix**: remove the `(?i)` flag so only all-uppercase
env-var-style identifiers (which is the actual convention this pattern
is supposed to catch) match. Three other `aws_secret_key` /
`env_var_assign` -style patterns may want the same review.

**Where the fix would land**: `orchestrator/secret_scanner.py` —
single-character regex change. Could ship as M19-P5b if you want a
re-run of this E2E to demonstrate Gemini PASS-able evidence.

### Finding M19-F2 (low): `runs` table is empty for the local backend

`SELECT COUNT(*) FROM runs WHERE task_id = ?` returned 0 even though
worker phases clearly ran. This is consistent with the local-subprocess
backend not emitting `runs` rows (the Docker backend likely does). Not
a new regression; was the same in M17 + M18. Tracking only.

## Final 12 questions (per M19 directive)

1. Is remote/tag/release state consistent? — ✅ Yes (M19-P0 fixed beta.0 release; main fast-forward deferred to beta.1 per user instruction).
2. Was BR-001 fixed? — ✅ Yes (code shipped + 18 unit tests + exercised live).
3. Was BR-002 fixed? — ✅ Yes (code shipped + 28 unit tests + GEMINI_API_KEY pickup proven live).
4. Was BR-003 fixed? — ✅ Yes (code shipped + 25 tests + 3 rows written live).
5. Did all tests pass? — ✅ 490 passing.
6. Did third real E2E run? — ✅ Yes (PR #54).
7. Did validators receive diff body? — ✅ Yes (rendered with BLOCKED warning, per the secret-hit path; the redaction is what was passed, not the original body).
8. Did real validators PASS? — ❌ NO. Gemini returned `NEEDS_HUMAN` (honest reasoning — couldn't see code because of redaction). OpenAI was mock. Per user instruction: "if no keys, do not claim beta E2E auto-merge proof" — we do not claim it.
9. Did auto-merge happen? — ❌ NO. Held by M18-P1 gate (correct).
10. If not, exactly why? — Two layered reasons. Layer 1: `openai-mock` cannot satisfy `validators.allow_mock_validators_for_auto_merge: false`. Layer 2: even with both validators real, the BR-001 false positive in Finding M19-F1 would have kept the body redacted → Gemini still NEEDS_HUMAN.
11. Was Anthropic API spend still $0? — ✅ $0.00.
12. Is this now beta.1-ready? — **Conditionally yes**. The three backlog items are closed, infrastructure is verified live. Finding M19-F1 (regex too loose) is a 1-char fix and we recommend landing it as M19-P5b before tagging beta.1, otherwise BR-001's promise of "validators see real code" is mostly false in practice on real Python diffs.

## Cleanup

- PR #54 left open (draft, pending approval) so the user can inspect
  the actual worker output if desired. Suggest closing once review is
  done: `gh pr close 54 -R CTlanston/auto-evo-playground -d`.
- Workspace at `~/.claude-code-247/workspaces/task_01KSDR1DGG4DV8XNGZSR7506QC/`
  preserved (replay-friendly).
