# Cost modes

## Default: `cheap`

| | cheap | balanced | premium |
| --- | --- | --- | --- |
| Coder | Claude Code CLI | Claude Code CLI | Claude Code CLI |
| Reviewer | CLI (Sonnet) | CLI (Sonnet) | CLI (Sonnet) |
| Guardian (Opus, expensive) | local/CLI only | final-PR-gate via CLI | Opus via API if allowed |
| Anthropic SDK / API | **forbidden** | forbidden unless config permits | allowed if budget + config |
| Daily $ cap | $0 | configurable | configurable |

## How it's enforced

Three lines of defence:

1. **Static**: `autodev/cost_policy.py:CostPolicy.is_executor_allowed()`
   is called by every site that wants to spend money.
2. **Inner engine**: `orchestrator/local_runner.py` only calls the
   Anthropic SDK when `LOCAL_USE_SDK=1`, AND `main.py`'s `run_guardian()`
   short-circuits `daily_cost_usd` to 0 when the token prefix is
   `sk-ant-oat01-` (subscription auth).
3. **Audit**: every denied call gets a `COST-DENY` row in
   `reports/decisions.md`. If you see one, the supervisor refused to
   spend money even though something asked to.

## How to change modes

```bash
echo "/set-mode balanced" >> commands/inbox.md
./scripts/autodev_once.sh
```

Or edit `HUMAN_CONFIG.md`:

```yaml
cost:
  mode: balanced
  anthropic_sdk_api_allowed: false
  daily_usd_cap: 0
  premium_guardian_allowed: false
```

## Subscription vs API

The supervisor prefers subscription auth (`sk-ant-oat01-...`) via
`CLAUDE_CODE_OAUTH_TOKEN`. Subscription has no per-call USD cost, so the
cost controller never blocks CLI use. Rate limits still apply (Pro tier:
~5 hours rolling window); the inner engine handles that via its existing
`state/RATE_LIMITED` flag.

If you set an API key (`sk-ant-api03-...`) instead, the cost controller
becomes the binding constraint: cheap mode denies all API spend; balanced
honours `daily_usd_cap`; premium allows the Opus Guardian if config
permits.
