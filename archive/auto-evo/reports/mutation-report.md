# Mutation report — billable.py

Total mutations: **21** · killed: **21** · survived: **0** · kill rate: **100.00%**

## Per-mutant details

| # | Kind | Location | Original → Mutant | Result |
|---|---|---|---|---|
| 1 | return | line 34 | `return (env.get('ANTHROPIC_API_KEY') or ` → `return None` | killed |
| 2 | return | line 94 | `return metrics` → `return None` | killed |
| 3 | return | line 33 | `return True` → `return None` | killed |
| 4 | return | line 50 | `return 0.0` → `return None` | killed |
| 5 | return | line 52 | `return 0.0` → `return None` | killed |
| 6 | return | line 54 | `return max(0.0, float(raw_cost_usd or 0.` → `return None` | killed |
| 7 | return | line 75 | `return metrics` → `return None` | killed |
| 8 | boolean | line 33 | `True` → `False` | killed |
| 9 | comparison | line 51 | `(in_tokens or 0) == 0` → `(in_tokens or 0) != 0` | killed |
| 10 | comparison | line 51 | `(out_tokens or 0) == 0` → `(out_tokens or 0) != 0` | killed |
| 11 | return | line 56 | `return 0.0` → `return None` | killed |
| 12 | binop | line 81 | `state_dir / 'orchestrator.db'` → `state_dir * 'orchestrator.db'` | killed |
| 13 | unaryop | line 82 | `not db_path.exists()` → `db_path.exists()` | killed |
| 14 | return | line 83 | `return metrics` → `return None` | killed |
| 15 | binop | line 84 | `time.time() - 86400` → `time.time() + 86400` | killed |
| 16 | numeric | line 84 | `300` → `301` | killed |
| 17 | numeric | line 84 | `300` → `299` | killed |
| 18 | numeric | line 84 | `86400` → `86401` | killed |
| 19 | numeric | line 84 | `86400` → `86399` | killed |
| 20 | numeric | line 85 | `5` → `6` | killed |
| 21 | numeric | line 85 | `5` → `4` | killed |
