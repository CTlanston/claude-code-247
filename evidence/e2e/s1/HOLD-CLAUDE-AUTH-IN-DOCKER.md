# HOLD-CLAUDE-AUTH-IN-DOCKER

**Opened:** 2026-05-30 (s_0029, E2E-1 live run attempt)
**Stage:** E2E-1 — Real End-to-End Loop
**Reason class:** `secret_grant_request` / auth-into-container (∞ TTL — needs human)
**Status:** OPEN — blocks the E2E-1 live run. **No silent paid-API fallback** (CLAUDE.md non-negotiable #6).

## What was attempted

Run the real loop on `CTlanston/multi-agent-brainstorm`: subscription Claude CLI
**inside a Docker container** as the coder, with the macOS-keychain Claude
credential mounted **read-only** into the container, `ANTHROPIC_*` stripped so it
cannot fall back to the paid API.

## What happened (evidence, two attempts)

1. **First attempt — wrong image.** `scripts/e2e1-real-loop.ts` defaulted to
   `claude-code-247/orchestrator:latest`, which does **not** contain the `claude`
   binary → container exit 127, `exec: "claude": executable file not found in
   $PATH`. Coder produced 0 tokens / 0 changes; both real validators returned
   `fail`; MergePolicy `BLOCKED`; **no PR opened** (correct — nothing to PR).
   Evidence: `evidence/e2e/s1/run/tasks/<task>/docker-meta.json` (exitCode 127),
   `stderr.log`. **Fix applied:** default image → `claude-code-247/runner:latest`
   (ships `claude` at `/usr/local/bin/claude`, v2.1.133).

2. **Second attempt — correct image, auth probe.** Direct probe against
   `runner:latest` with the same mounted credential:
   ```
   is_error=True
   result="Failed to authenticate. API Error: 401 Invalid bearer token"
   in/out tokens = 0/0
   ```
   So `claude` executes and reads the mounted credential, but **subscription
   OAuth auth fails with 401 inside the container.**

## Root-cause diagnosis (decisive)

| Check | Result |
|---|---|
| Host `claude --print` right now (same subscription/machine) | **WORKS** — `is_error=False`, real tokens 5/15 |
| Token `expiresAt` (1780103306765) vs now | **NOT expired** — expires 2026-05-30T01:08:26Z, run was ~00:34Z |
| Same `.credentials.json` mounted read-only into container | **401 Invalid bearer token** |

Conclusion: the credential **value** is valid, but the OAuth access token is
**not portable into the container**. The host CLI authenticates via the macOS
keychain (and refreshes the short-lived access token through it at call time); a
bare `.credentials.json` bind-mount reproduces neither the keychain-bound binding
nor the refresh path. The token appears **host/keychain-bound** — exactly the risk
ADR-0019 flagged.

## What is NOT the problem

- Not a missing binary (fixed: `runner:latest` has claude).
- Not an expired token (33 min of validity remained).
- Not the container plumbing: credential mounted `:ro`, host path redacted in
  `docker-meta.json`, `ANTHROPIC_*` stripped — all verified working.
- Not a code bug in `ClaudeDockerRunner` — it did exactly what it should and
  surfaced the auth failure instead of faking success.

## Options for the operator (pick one; all avoid silent paid-API fallback)

1. **`claude /login` inside the image** — exec an interactive login in a
   persistent `runner` container, commit/persist the resulting container-side
   credential (or a volume), so the container holds its **own** valid session.
   Most faithful to "subscription coder in Docker."
2. **`claude setup-token` / long-lived token** — if the subscription supports a
   non-keychain-bound token, materialize that into the container instead of the
   keychain blob. (Still subscription, not metered API.)
3. **Run the coder on the host via `LocalCliRunner('claude')`** instead of
   Docker for this proof — host auth works today (verified). Trades GR#8's
   container-isolation boundary; **requires explicit operator approval** as a
   conscious, logged exception (not silent).
4. **Approved metered-API path** — only with an explicit operator config flag +
   logged switch (CLAUDE.md #6). Not taken here.

## Everything else in the loop is proven wired (this run)

`runs=1`, `validator_results=2` (real Gemini + real OpenAI, independent families),
`model_usage=1` row + `model.usage.recorded` event=1, credential
materialized→scrubbed, global `allow_remote_writes` untouched (stayed false),
anti-slop gate correctly BLOCKED an empty diff and opened **no** PR. The only
blocker is container-side subscription auth.
