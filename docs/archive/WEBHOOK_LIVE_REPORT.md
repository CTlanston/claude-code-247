# WEBHOOK_LIVE_REPORT.md — M18-P3 live ngrok validation

> Live round-trip verified: real GitHub webhook deliveries reach the
> local `/webhooks/github` endpoint with HMAC validated, handler runs,
> DB rows + logs persist.

## Setup

| Item | Value |
|---|---|
| Tunnel tool | **ngrok 3.39.0** (free tier, ephemeral URL) |
| Public URL  | `https://d8d1-31-221-8-167.ngrok-free.app` (ephemeral) |
| Local dashboard | `http://127.0.0.1:8423` |
| Webhook secret | 32 hex chars, random per run, never committed |
| Repo | `CTlanston/auto-evo-playground` |
| GitHub webhook id | `630064720` |
| Events subscribed | `pull_request`, `check_run`, `check_suite`, `ping` |

## Step trace

1. **Generate secret** — `secrets.token_hex(16)` → wrote into
   `~/.claude-code-247/config.yaml::github.webhook_secret`. Saved to
   `/tmp/cc247-webhook.secret` (gitignored / chmod 600) for the
   `gh api` step. Never logged.
2. **Start dashboard** — `nohup uvicorn dashboard.app:app --host
   127.0.0.1 --port 8423 &`. Verified `GET /healthz` returns
   `{"ok":true}`.
3. **Start ngrok** — `nohup ngrok http 8423 &`. Parsed the public
   URL from ngrok's local API at `http://127.0.0.1:4040/api/tunnels`.
4. **Verify tunnel** — `curl <public>/healthz` with
   `ngrok-skip-browser-warning: 1` header → `{"ok":true}`.
5. **Create webhook** — `gh api repos/.../hooks -X POST --input -`
   with a JSON body (boolean `active: true` requires raw JSON, not
   `-f`'s string form). Got webhook id `630064720`.
6. **Force ping** — `gh api .../hooks/<id>/pings -X POST`. GitHub
   delivered the ping.
7. **Open real PR** — created throwaway branch
   `cc247-webhook-test-1779645641`, pushed one tiny commit, ran
   `gh pr create` → PR #52 opened.

## Delivery evidence (from `gh api .../deliveries`)

| Event | Action | HTTP | Notes |
|---|---|---|---|
| ping | (none) | 200 | auto-delivered on hook creation |
| ping | (none) | 200 | forced via `pings` API |
| pull_request | opened | 200 | PR #52 creation |
| check_run | created (×4) | 200 | each workflow's check |
| check_run | completed (×3) | 200 | each workflow's completion |

## Local-side evidence

**Dashboard log (real source IPs 140.82.115.x = GitHub webhook range)**:
```
INFO: 140.82.115.90:0  - "POST /webhooks/github HTTP/1.1" 200 OK
INFO: 140.82.115.28:0  - "POST /webhooks/github HTTP/1.1" 200 OK
INFO: 140.82.115.126:0 - "POST /webhooks/github HTTP/1.1" 200 OK
... (≥10 deliveries)
```

**DB `logs` table** (sqlite3 query):
```
2026-05-24T18:01:04.810Z | info | github event handled: check_run action=completed
2026-05-24T18:01:03.203Z | info | github event handled: check_run action=completed
2026-05-24T18:01:00.727Z | info | github event handled: check_run action=completed
2026-05-24T18:00:49.098Z | info | github event handled: check_run action=created
2026-05-24T18:00:49.091Z | info | github event handled: check_run action=created
2026-05-24T18:00:49.081Z | info | github event handled: check_run action=created
2026-05-24T18:00:49.070Z | info | github event handled: check_run action=created
2026-05-24T18:00:46.540Z | info | github event handled: pull_request action=opened
2026-05-24T18:00:17.333Z | info | github event ignored: ping action=None
2026-05-24T18:00:05.989Z | info | github event ignored: ping action=None
```

## What was validated

| Behavior | Result |
|---|---|
| Tunnel delivers requests to local dashboard | ✓ |
| HMAC-SHA256 signature accepted | ✓ (all 200) |
| Bad signature would be rejected | already covered by `tests/integration/test_webhooks_route.py::test_webhook_401_on_bad_signature` |
| `ping` events accepted (currently as noop) | ✓ |
| `pull_request opened` event handled | ✓ |
| `check_run created/completed` events handled | ✓ (≥7 deliveries) |
| Events recorded in `logs` table | ✓ |
| DB never mutated for unknown PRs (PR #52 was not opened by claude247) | ✓ — safety: only PRs claude247 created get `prs` table updates |

## Notes & follow-ups

- **`ping` is currently routed as "unknown event noop"**. GitHub
  accepts the 200 response and considers delivery successful, so
  this is functional, but adding an explicit `ping` handler in
  `orchestrator/webhooks.py::HANDLERS` would be cleaner. Filed as
  a M18-P3 follow-up (small).
- **`prs` table not updated for PR #52**. By design — `handle_pull_
  request` only updates rows it already owns. If we ever want to
  ingest externally-created PRs, that's a deliberate config flag.
- **Tunnel is ephemeral**. ngrok-free URLs change on restart; for
  production webhooks the operator should use cloudflared with a
  permanent hostname OR ngrok paid plan.

## Cleanup (run after this report is committed)

```bash
gh api -X DELETE repos/CTlanston/auto-evo-playground/hooks/630064720
gh pr close 52 --repo CTlanston/auto-evo-playground --delete-branch
kill $(cat /tmp/cc247-ngrok.pid)
kill $(cat /tmp/cc247-dash.pid)
rm -f /tmp/cc247-webhook.secret /tmp/cc247-public-url.txt
python3 -c "
import yaml, pathlib
p = pathlib.Path.home() / '.claude-code-247' / 'config.yaml'
data = yaml.safe_load(p.read_text())
data.get('github', {}).pop('webhook_secret', None)
p.write_text(yaml.safe_dump(data, sort_keys=False))
"
```

## Verdict: PASS

Real GitHub webhook delivery to a locally-hosted `/webhooks/github`
endpoint behind ngrok works. HMAC verification works. Handler routes
events correctly. DB persists `logs` entries. PR #52 is the live
artifact: https://github.com/CTlanston/auto-evo-playground/pull/52
