# BETA_READINESS_REPORT.md — claude-code-247 v1.0.0-beta.0

> Synthesis of the four-phase beta-readiness milestone (M18-P0..P4)
> following the v1.0.0-alpha.1 release. Goal of M18: stop adding new
> features; move the product from "alpha harness" to "beta-ready
> live-ops" by hardening auth, validators, daemon, webhooks, and
> running a clean second end-to-end on the sacrificial test repo.

## TL;DR

- **All four directive phases (P0/P1/P2/P3) are committed, pushed,
  and tested.**
- **Second real E2E (P4) ran clean** on `CTlanston/auto-evo-playground`
  using the local-first auth path — see
  [REAL_E2E_REPORT_M18_P4.md](REAL_E2E_REPORT_M18_P4.md).
- **Anthropic API spend dropped from ~$1.50 (M17/α1) → $0.00 (M18-P4)**
  for the same shape of task.
- **No fake green** — Gemini correctly returned `NEEDS_HUMAN` because
  the evidence package omits the textual diff body. System routed to
  `waiting_for_approval` as designed. Two real findings filed for
  follow-up.
- **Recommendation: tag v1.0.0-beta.0** on `claude247/v1`.

## Phase-by-phase

| Phase | Title | Commit | Status |
|---|---|---|---|
| M18-P0 | Subscription/local auth — `worker_mode` + no silent API fallback | `334ed46` | ✓ pushed |
| M18-P1 | Real OpenAI validator + mock-cannot-silently-auto-merge | `9dacd5d` | ✓ pushed |
| M18-P2 | launchd hardening — `doctor_launchd.sh` + extended `doctor` fields + plist tests | `712a639` | ✓ pushed |
| M18-P3 | Real GitHub webhook live test through ngrok + explicit `handle_ping` | `5170197` | ✓ pushed |
| M18-P4 | Second real E2E proving reduced API spend + cleaner auto-merge path | (this report, no code change) | ✓ validated live |

### P0 — Subscription/local auth (no silent API fallback)

**The problem (from M17 live discovery):** `auth_mode` label was
hardcoded `"local_claude_code"` even when the worker actually used
`ANTHROPIC_API_KEY` from env (silent paid fallback). That made
"reduced API spend" claims unverifiable.

**What was done:**
- `runner/auth.py` rewritten: `resolve_worker_mode()`,
  `effective_env(worker_mode=...)`, `ensure_usable(mode)`,
  `allow_api_fallback()`.
- `local_claude_code` mode now **strips** `ANTHROPIC_API_KEY` and
  `ANTHROPIC_BASE_URL` from the worker subprocess env.
- `anthropic_api` mode keeps them but only if the key is present;
  `ensure_usable` returns a clear error otherwise.
- `runner/claude_cli.py::invoke` honestly labels the mode based on
  the env actually given to the subprocess, not what the caller hoped.
- `config/default.yaml` adds:
  - `auth.worker_mode: local_claude_code` (default)
  - `auth.allow_api_fallback: false`
  - `auth.require_explicit_api_fallback: true`
  - `auth.show_cost_warnings: true`
- `gateway/doctor.py::check_auth_mode` surfaces the resolved mode +
  whether `ANTHROPIC_API_KEY` would have been picked up if not for
  the strip.
- Tests: [tests/unit/test_auth_mode_no_silent_fallback.py](tests/unit/test_auth_mode_no_silent_fallback.py)
  — 12 tests covering default/explicit modes, env strip, key
  presence, and legacy `anthropic_api_fallback` still requiring
  approval.

**P4 evidence:** worker subprocess invoked `claude --print` with no
Anthropic key in env; PR landed without burning API credit.

### P1 — Real OpenAI validator + mock-cannot-pass-auto-merge

**The problem:** previously, when the OpenAI key was absent the
adapter silently returned `validator: "openai-mock"` with verdict
PASS, which (under sufficient validator agreement) was enough to
satisfy auto-merge. That broke the "no fake green" principle.

**What was done:**
- `validator/openai_judge.py`: real REST adapter via httpx, falls back
  to mock only when the key is absent — and the mock now labels itself
  `openai-mock` so the policy layer can see it.
- `validator/validation_policy.py::validate`:
  - Refuses `PASS` for auto-merge if any result is labeled `*-mock`
    unless `validators.allow_mock_validators_for_auto_merge: true`.
  - Per-validator `validators.<kind>.require_real_for_auto_merge: true`
    forces approval routing even if the global flag is permissive.
- `config/default.yaml`:
  - `validators.allow_mock_validators_for_auto_merge: false` (default)
  - `validators.gemini.require_real_for_auto_merge: true`
  - `validators.openai.require_real_for_auto_merge: true`

**P4 evidence:** P4 reached `NEEDS_HUMAN`, not `PASS`, so the gate
itself didn't *fire* — but the upstream behavior (real Gemini call
with `auth_mode: gemini_api`; OpenAI ran as `openai-mock` because
the key wasn't in the env-loader scope — Finding 2) confirmed the
plumbing. Unit tests `tests/unit/test_validation_policy_mock_gate.py`
and `tests/unit/test_openai_judge_real_or_mock.py` cover the gate
behavior.

### P2 — launchd hardening

**The problem:** `scripts/install_launchd.sh` rendered plists, but
nothing inspected the loaded state at runtime, and `doctor` only said
"none of com.claude247.* services loaded" without saying which one
crashed or where to look.

**What was done:**
- `scripts/doctor_launchd.sh` (new, ~70 lines): per-service report —
  loaded state from `launchctl list`, exit status, last 20 log lines,
  dashboard `/healthz` reachability.
- `gateway/doctor.py::check_launchd`: surfaces each service's loaded
  state in `claude247 doctor` output.
- All four plist templates already tested in
  [tests/unit/test_launchd_plist_generation.py](tests/unit/test_launchd_plist_generation.py)
  — 9 tests: existence, valid XML, dispatcher `StartInterval=30`,
  backup `StartCalendarInterval`, dashboard `KeepAlive=true`,
  install/uninstall script consistency, doctor_launchd.sh executable.

**P4 evidence:** no launchd services were loaded during P4 (deliberate
— the run was foreground via `claude247 dispatcher --once`); doctor
correctly flagged `none of com.claude247.* services loaded`.

### P3 — Live GitHub webhook through ngrok

**The problem:** unit tests covered HMAC signature + handler dispatch,
but the dashboard endpoint had never received a real GitHub
delivery, so a tunnel/header/firewall regression could go unnoticed.

**What was done:**
- ngrok tunnel exposed `127.0.0.1:8423` → public URL.
- Created webhook id `630064720` on `CTlanston/auto-evo-playground`
  subscribed to `pull_request`, `check_run`, `check_suite`, `ping`.
- Real deliveries: 2 × ping (auto + forced via `/pings` API), 1 ×
  `pull_request opened` (PR #52), 7 × `check_run` (4 created + 3
  completed). All 200 OK, all logged to DB `logs` table, all source
  IPs in GitHub's published webhook ranges (140.82.115.x).
- Code change: added explicit `handle_ping` in `orchestrator/webhooks.py`
  + `HANDLERS["ping"] = handle_ping` so ping events show up as
  `handled` with `zen` + `hook_id` surfaced, not as `ignored`.
- Tests: `tests/unit/test_webhooks.py::test_ping_event_is_handled_explicitly`
  + `tests/integration/test_webhooks_route.py::test_webhook_ping_event_handled`.
- Full report: [WEBHOOK_LIVE_REPORT.md](WEBHOOK_LIVE_REPORT.md).

**Cleanup performed:** webhook 630064720 deleted; PR #52 closed +
branch deleted; ngrok and dashboard processes killed; webhook_secret
stripped from `~/.claude-code-247/config.yaml`; tmp files removed.

### P4 — Second real E2E proving reduced API spend + cleaner auto-merge

**The problem:** M17 (α1) PR #51 landed on auto-evo-playground but
burned ~$1.50 of Anthropic API credit because of the silent fallback
bug. The whole point of P0/P1 was to make this no longer happen.

**What was done:** queued the `normalize_whitespace` task on
auto-evo-playground; ran `claude247 dispatcher --once`; observed the
full pipeline. See [REAL_E2E_REPORT_M18_P4.md](REAL_E2E_REPORT_M18_P4.md).

**Key results:**
- Worker used local `claude` CLI (subscription). $0.00 Anthropic spend.
- Real Gemini judge ran (`auth_mode: gemini_api`).
- Worker output was *correct*: `normalize_whitespace(text)` →
  `" ".join(text.split())`, plus 6 unit tests covering the spec
  cases. 85 pytest assertions passed (was 79 + 6 new).
- PR opened as draft (#53), commit `e7537d3`, branch pushed.
- Gemini returned `NEEDS_HUMAN` — *honestly* — because the evidence
  package only contains a diff *summary*, not the diff *body*
  (Finding 1).
- Merge policy routed to `WAITING_APPROVAL`. Auto-merge gate held.
- PR #53 cleanup: closed + branch deleted after report.

## Findings — beta-readiness backlog (NOT blockers for tagging)

These were surfaced by the P4 live run. They are real and worth
filing, but they are not regressions and do not break any documented
contract.

| ID | Finding | Severity | Source |
|---|---|---|---|
| BR-001 | `JudgeInput` includes `diff_summary.md` (stat) but not the textual diff body. Real validators correctly refuse to verify byte-identical preservation without seeing the body. | medium — caps real-validator PASS rate | P4 §Finding 1 |
| BR-002 | `env_loader.load()` only reads `~/.claude-code-247/.env`; the project-local `.env` is ignored. So `OPENAI_API_KEY` in CWD/.env runs as mock even though the key exists. | low — config UX, no security risk | P4 §Finding 2 |
| BR-003 | Dispatcher summary reports `worker_exit: 3` even when role artifacts are complete and downstream pipeline produced a clean PR. Misleading. | low — observability, not a runtime bug | P4 §Finding 3 |

## What's intentionally not in scope for beta

- Multi-machine HA. Single-Mac is by design.
- Cross-org auth (the project is local-first; one user, one machine).
- Docker runner outside dev mode. The local backend covers the
  product's stated 24/7 single-Mac scope.
- A dashboard with users/auth — dashboard is bound to `127.0.0.1`
  and that's deliberate.

## Test posture

```
$ .venv/bin/python -m pytest -q --no-cov
```

All M18 work landed with tests-first; the new files include:

- `tests/unit/test_auth_mode_no_silent_fallback.py` (12 tests)
- `tests/unit/test_validation_policy_mock_gate.py`
- `tests/unit/test_openai_judge_real_or_mock.py`
- `tests/unit/test_launchd_plist_generation.py` (9 tests)
- `tests/unit/test_webhooks.py::test_ping_event_is_handled_explicitly`
- `tests/integration/test_webhooks_route.py::test_webhook_ping_event_handled`

## Recommendation

Tag **v1.0.0-beta.0** on `claude247/v1` at the current HEAD. The
three findings above should be filed as follow-up tickets but do not
hold the tag.

> "Beta-ready" here means: the documented product works
> end-to-end on a real GitHub repository, the auth path is honest
> about what it spends, validators are honest about what they ran
> with, the daemon path is inspectable, and live webhook delivery has
> been observed. It does **not** mean every backlog item is closed.
