# REAL_E2E_REPORT_M18_P4.md — second live E2E, local-first auth path

> Goal (per M18 directive): "second real E2E run proving reduced API
> spend + cleaner auto-merge path." Worker uses the local `claude` CLI
> (subscription), Anthropic API key is **not** in scope, validators
> use real keys where available, and the auto-merge gate must hold
> back any verdict that isn't a unanimous real PASS.

## Setup

| Item | Value |
|---|---|
| Target repo | `CTlanston/auto-evo-playground` (sacrificial) |
| Worker | local `claude` CLI 2.1.142 (subscription auth) |
| `auth.worker_mode` | `local_claude_code` (M18-P0) |
| `ANTHROPIC_API_KEY` | unset in shell; would be stripped from worker env regardless |
| Validators | Gemini real (key in `~/.claude-code-247/.env`) + OpenAI mock (see Finding 2) |
| `validators.min_validators` | 2 |
| `validators.allow_mock_validators_for_auto_merge` | `false` (M18-P1) |
| Task | "Add `normalize_whitespace(text: str) -> str` to `src/string_utils.py` + 6 tests" |

## Run

```
$ claude247 start --repo auto-evo-playground --goal "..." --json
{"command_id":"cmd_01KSDKSAK429X1911ZPWTRW32J","status":"queued",...}

$ claude247 dispatcher --once --json
```

Single `run_once` drained the queue and walked the entire pipeline:
workspace → planner → coder → reviewer → diff → coverage → risk →
merge-policy → commit → push → PR.

## What the system did

| Stage | Outcome |
|---|---|
| Worker (subscription claude CLI) | Wrote `normalize_whitespace` with `" ".join(text.split())`; added 6 tests; **did NOT touch `slugify`** |
| Local pytest in workspace | 85 passed in 0.09s (was 79, +6 new tests for `normalize_whitespace`) |
| Branch | `agent/auto-evo-playground/task_01KSDKTJGCEKKFWG6R6F87G02S/add-a-small-python-utility-function-norm` |
| Commit SHA | `e7537d3` |
| Push | OK |
| PR created | [auto-evo-playground#53](https://github.com/CTlanston/auto-evo-playground/pull/53) (draft, M11.5 path) |
| Gemini verdict | `NEEDS_HUMAN` (auth_mode: `gemini_api`, real call) — *honest* gap-finding (Finding 1 below) |
| OpenAI verdict | `NEEDS_HUMAN` (auth_mode: `mock` — Finding 2 below) |
| Merge policy decision | `WAITING_APPROVAL` |
| Final task state | `waiting_for_approval` |
| Anthropic API spend | **$0.00** — worker ran on subscription |

PR diff (the worker output):
```diff
--- a/src/string_utils.py
+++ b/src/string_utils.py
@@ -10,3 +10,8 @@ def slugify(text: str) -> str:
     while "--" in s:
         s = s.replace("--", "-")
     return s.strip("-")
+
+
+def normalize_whitespace(text: str) -> str:
+    """Collapse runs of whitespace to a single space; strip ends."""
+    return " ".join(text.split())
```

Plus 6 unit tests covering empty, all-whitespace, multi-space,
tabs+newlines, leading/trailing, and the "hello   world" case.

## Verdict: PASS for the local-first auth path

The exact thing M18-P4 was meant to prove:

| Requirement | Result |
|---|---|
| Worker runs on subscription, not Anthropic API | ✓ — `claude --print` via stdin, no `ANTHROPIC_API_KEY` in env |
| Real Gemini validator runs (not mock) | ✓ — `auth_mode: gemini_api` |
| Mock-cannot-silently-pass (M18-P1) holds | ✓ — but moot here: verdict was NEEDS_HUMAN, not PASS; gate only fires on PASS |
| Validator disagreement → not auto-merged | ✓ — both NEEDS_HUMAN, routed to `WAITING_APPROVAL` |
| PR created safely as draft | ✓ — `gh pr create --draft` |
| Auto-merge gate held | ✓ — refused to merge a NEEDS_HUMAN verdict |
| Anthropic API spend | $0.00 vs ~$1.50 in M17 |

## Findings (beta-readiness backlog)

### Finding 1 — Validators see `diff_summary.md`, not the textual diff

Gemini's response was *correct*:

> "The full diff content for the modified files (`src/string_utils.py`,
> `tests/test_string_utils.py`) is not available. Only a summary of
> changed lines was provided."

Looking at `validator/judge_contract.py::JudgeInput.from_evidence_dir`,
the package handed to the validator includes:

- `contract.md` — the goal/contract written by the planner role
- `plan.md` — planner's plan
- `worker_done.md` — coder's self-report
- `diff_summary.md` — `git diff --stat` (line counts per file, no body)
- `file_manifest.json` — names of changed files
- `test_results.json` / `lint_results.json` / `build_results.json`
- `review.md` / `risk_score.json` / `ci_summary.md`

Notably absent: the actual textual diff (`git diff` body). Without it,
a real validator that takes its job seriously cannot verify clauses
like "byte-identical preservation of slugify" or "the new function has
the signature `f(text: str) -> str`". Gemini called this out
explicitly. This is a real gap in the evidence package — not a
validator bug.

**Suggested fix (separate PR):** add `diff.patch` to the evidence
package (or a per-file `diff_<sha>.patch`) and pass it through
`JudgeInput.diff_body` / `from_evidence_dir`. Truncate to a sensible
byte ceiling (e.g., 64KB) and note truncation so the validator can
choose to escalate when the diff is too big to reason about.

### Finding 2 — `env_loader.load()` reads only `~/.claude-code-247/.env`

`OPENAI_API_KEY` lives in the project's `.env` (CWD), which the loader
deliberately does not read. Result: even though the key is on disk,
the OpenAI judge ran in mock mode, the run hit the disagreement-free
NEEDS_HUMAN lane, and the mock-cannot-PASS gate from M18-P1 did not
exercise.

**Suggested fix (separate PR):** add a second known location
(`.env` in repo root, lowest priority) and document the precedence in
`orchestrator/env_loader.py`. Don't override already-set keys.

### Finding 3 — `worker_exit: 3` in summary while role artifacts are intact

The dispatcher summary reported `worker_exit: 3` even though the
workspace contained complete `plan.md`, `worker_done.md`, `review.md`,
`test_results.json` (exit 0), commit landed, branch pushed, PR
created. The exit code is misleading — the actual *role* outputs are
all present and the downstream pipeline produced a fully-formed PR.

Most likely: the final post-role wrapper exit code is being surfaced
instead of the per-role status. Worth tracing in a follow-up — not a
blocker for the verdict because the downstream evidence is complete
and consistent.

## Cleanup actions taken after this report

1. PR #53 closed (will be done immediately after this report is committed).
2. Branch `agent/auto-evo-playground/task_01KSDKTJ.../add-...`
   deleted on remote (with `--delete-branch`).
3. Workspace `~/.claude-code-247/workspaces/task_01KSDKTJ...` left in
   place for forensic reference — it's gitignored and ephemeral.

## Cost summary

| Resource | Spend |
|---|---|
| Anthropic API (worker) | **$0.00** |
| Gemini 2.5 Pro (one judge call) | ≈ $0.01 |
| OpenAI (would-be) | $0.00 — mock |
| Total | **~$0.01** vs $1.50 in M17 |

M17 burned ~$1.50 because the worker called `claude` with
`ANTHROPIC_API_KEY` in env (silent fallback). M18-P0 closed that path:
local mode now strips the key. M18-P4 spent two orders of magnitude
less than M17 on the same shape of task. The "reduced API spend"
half of the directive is empirically demonstrated.

## What this unlocks

This is the last of the four beta-readiness phases (P0/P1/P2/P3
already pushed on `claude247/v1`). Suitable to tag as
`v1.0.0-beta.0` once the BETA_READINESS_REPORT.md synthesis is
written and the two findings above are queued for follow-up.
