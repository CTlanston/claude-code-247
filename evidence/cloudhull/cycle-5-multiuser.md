# CloudHull Cycle 5 — smallest safe multi-user prototype (evidence)

Date: 2026-06-11 · Branch: `claude/cloudhull-alpha`
Scope: one shared Mac, trusted-local users only (Tailscale LAN), NO SaaS auth.
The `x-aedev-user` header and the `submittedBy` field are plain display names
for attribution on a trusted LAN — they are explicitly **NOT authentication**
(documented in `packages/daemon/src/owner-gate.ts`). The safety model is
unchanged: remote writes stay gated by `allow_remote_writes`, merge stays
human-only.

## What shipped

1. **Display name on submission** — `POST /operator/sessions` accepts optional
   `submittedBy` (trimmed, ≤40 chars; credential red line
   `/token|api[_-]?key|secret/i` → 400). Persisted via migration v9
   (`operator_sessions.submitted_by`, nullable, skipIf-guarded; backfill-at-read
   `'owner'`, same rule as `events.operator_id`). Session GET/list include it.
   Audit: `operator.session.created` payload carries `submittedBy`;
   `operator.questions_answered` carries `answeredBy` when the header is set;
   approve/start/create-pr payloads carry `actor`.
2. **Owner-only actions** — `AEDEV_OWNER_NAME` (default `owner`).
   approve-roadmap / start / create-pr require a matching `x-aedev-user`
   (absent header = owner, full backward compat). Non-owner → 403 with
   `humanState: 'waiting_for_approval'` and calm bilingual guidance
   (“这一步需要 Owner 执行 · this step belongs to the owner”); the refusal is
   audited as `operator.owner_gate_refused`. Submitting sessions, answering
   clarifications and observing stay open to all.
3. **UI** — composer gains “你的名字 · Your name” (`cockpit-user-name-input`,
   persisted in `localStorage[aedevUserName]`, sent as `submittedBy` + the
   `x-aedev-user` header on every API call). Missions page groups operator
   sessions by `submittedBy` with the name visible. Plan/PrReady loop cards
   show “等待 Owner · waiting for owner” for non-owner viewers (derived
   client-side from the stored name vs `ownerName` in `GET /status`).
   Raw 403/400 codes never render: `mapErrorToHuman` turns owner-gate refusals
   into guidance; the five-card `next_step` invariant is untouched.

## Gates (this container, 2026-06-11)

- `pnpm typecheck` — PASS (26/26 packages) — **real**
- `pnpm lint` — PASS (exit 0) — **real**
- `GIT_CONFIG_GLOBAL=/tmp/test-gitconfig pnpm test` —
  **1022 passed | 6 skipped (138 files)**; baseline was 988 passed | 6 skipped,
  so +34 new tests, zero regressions — **real**
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm test:cockpit:user-e2e` —
  **PASS**, evidence in
  `evidence/browser-cockpit-user-e2e/2026-06-11T15-49-51-555Z/` (7/7 steps).
  The journey sends NO `x-aedev-user` header → it proves the owner
  backward-compat path end-to-end, plus a new assertion that the name input
  exists (left empty on purpose).

## Honest real vs simulated

- **Real**: all unit/route/migration/component tests above run against real
  code (in-memory SQLite, Fastify inject, jsdom + Testing Library). The
  user-e2e drives real chromium against the real daemon + vite dashboard.
- **Simulated**: the user-e2e planner/worker are the deterministic
  mock/template engines (`AEDEV_COCKPIT_FORCE_MOCK/TEMPLATE`), as in every
  prior cycle — no live Claude/Codex/Gemini call was made in this container.
- **Not proven here**: two different humans on two different Tailscale
  devices hitting one Mac concurrently. The multi-user behavior is proven at
  the HTTP contract level (different `x-aedev-user` values per request);
  a real two-device walkthrough on the owner's Mac remains operator-gated.
- **No PR was created; nothing was pushed by the system** (branch push is the
  human operator's git push of this work itself).
