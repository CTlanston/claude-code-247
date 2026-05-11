"""Execution adapters.

`claude_code_cli` is the primary, subscription-first executor. Other
executors (e.g. future Anthropic SDK adapter) MUST be cost-gated by
`autodev.cost_policy.CostPolicy.is_executor_allowed(name)`.
"""
