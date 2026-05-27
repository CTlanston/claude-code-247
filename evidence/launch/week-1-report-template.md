# Week-1 Live Fire Report — <UTC start> → <UTC end>

> Phase L1 exit artifact. Auto-generated from event log + the 7
> daily journals; the operator fills the 4 reflection questions at
> the bottom.

## Auto-generated section (from event-log reducer + Prometheus)

### Acceptance bullets (NEXT_PLAN_WORKBOOK §3 Phase L1)

| Bullet | Target | Observed | PASS? |
|---|---|---|---|
| daemon uptime ≥ 99.0% | 99.0% | _<fill>_ | _Y/N_ |
| ≥ 3 missions complete end-to-end | 3 | _<fill>_ | _Y/N_ |
| ≥ 1 auto-resolved HOLD cycle | 1 | _<fill>_ | _Y/N_ |
| 0 cost-cap breaches; cost < hard_cap | 0 / $15 | _<fill>_ | _Y/N_ |
| 0 idempotency collisions | 0 | _<fill>_ | _Y/N_ |
| ≥ 1 real cap-token rejection | 1 | _<fill>_ | _Y/N_ |

**SLA snapshot** (post_launch_review = end of this week):
- `daemon_uptime_pct_7d`: _<fill>_
- `autonomous_pr_success_rate_7d`: _<fill>_
- `cost_per_autonomous_pr_usd_7d`: _<fill>_ (hard cap $15)
- `sentinel_false_block_rate_7d`: _<fill>_
- `hold_mttr_p95_min_7d`: _<fill>_

### Mission tally
- Started: _<n>_
- Completed end-to-end: _<n>_
- Aborted (HOLD permanent): _<n>_
- Average cost: $_<n>_ (vs $8 target)

### HOLDs fired (any reason)
| Day | Reason | TTL hit? | MTTR (min) | Resolved by |
|---|---|---|---|---|

### Phone notifications
- Total: _<n>_
- Operator marked useful: _<n>_
- Noise tally: _<n>_

### Incidents (`evidence/launch/incident-NNNN.md`)
- Filed this week: _<count + ids>_
- Open: _<count + ids>_

---

## Operator reflection (workbook §3 Phase L1 L3 — 4 questions)

### Q1. Did the daemon surprise you in a bad way?
> Y / N + one line:
>
> _<fill>_

### Q2. Was the cost within expectation?
> Y / N + actual $:
>
> _<fill>_

### Q3. Was every phone notification useful?
> Y / N + count of noise:
>
> _<fill>_

### Q4. Did trust in the system grow or shrink this week?
> ↑ / ↓ / =
>
> _<fill>_

---

## Gate G2 decision (NEXT_PLAN_WORKBOOK §7)

- **≥ 4/6 acceptance bullets met + no data-loss incident** → proceed to L2
- **2-3 misses** → ADR + continue cautiously
- **≥ 4 misses, or any data-loss incident** → pause; consider `mesh.enabled=false` rollback

**Operator verdict:** _PROCEED / CAUTIOUS / PAUSE_

**Signature:** _<operator name + UTC>_
