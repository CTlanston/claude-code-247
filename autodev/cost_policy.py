"""CostPolicy — gate paid-API usage by cost mode.

Three modes from spec §8:

  cheap     — CLI/subscription only. Anthropic SDK/API forbidden, full stop.
  balanced  — CLI/subscription. SDK/API forbidden unless HUMAN_CONFIG.md
              explicitly permits and budget remains.
  premium   — CLI/subscription + Opus Guardian via SDK allowed if
              HUMAN_CONFIG.md permits and daily USD cap > 0.

The policy never silently allows an upgrade — every "denied" decision is
written to `reports/decisions.md` so we can audit why a Guardian fell back to
cheap mode.

Integration with the inner engine: any caller that wants to spend money MUST
go through `CostPolicy.is_executor_allowed("anthropic_sdk")` or the equivalent
`is_call_allowed("guardian_premium")` check. The inner engine's
`local_runner._call_anthropic_sdk()` path is one such caller; the cost
controller's audit-log captures every attempt.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .project_state import ProjectState


VALID_MODES = ("cheap", "balanced", "premium")


@dataclass
class CostDecision:
    allowed: bool
    reason: str
    operation: str
    mode: str


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def decisions_log_path() -> Path:
    return _project_root() / "reports" / "decisions.md"


def human_config_path() -> Path:
    return _project_root() / "HUMAN_CONFIG.md"


class CostPolicy:
    """Centralised cost-gating decisions.

    Reads HUMAN_CONFIG.md (if present) for explicit overrides; otherwise
    enforces the safest defaults.

    Usage:

        policy = CostPolicy.from_state(state)
        if not policy.is_executor_allowed("anthropic_sdk").allowed:
            fallback_to_cli()
    """

    DEFAULTS = {
        "mode": "cheap",
        "anthropic_sdk_api_allowed": False,
        "daily_usd_cap": 0.0,
        "premium_guardian_allowed": False,
    }

    def __init__(self, mode: str, *, allowed_sdk: bool, daily_cap: float,
                 premium_guardian: bool, today_spend: float = 0.0,
                 audit_log: Optional[Path] = None):
        if mode not in VALID_MODES:
            mode = "cheap"
        self.mode = mode
        self.allowed_sdk = bool(allowed_sdk) and mode != "cheap"
        self.daily_cap = float(daily_cap)
        self.premium_guardian = bool(premium_guardian) and mode == "premium"
        self.today_spend = float(today_spend)
        self._audit = audit_log or decisions_log_path()

    @classmethod
    def from_state(cls, state: ProjectState) -> "CostPolicy":
        cfg = cls._read_human_config()
        mode = state.get("cost_mode") or state.get("mode") or cfg["mode"]
        return cls(
            mode=mode,
            allowed_sdk=cfg["anthropic_sdk_api_allowed"],
            daily_cap=cfg["daily_usd_cap"],
            premium_guardian=cfg["premium_guardian_allowed"],
            today_spend=float(state.get("api_spend_today_usd") or 0.0),
        )

    # ----- gate decisions -------------------------------------------------

    def is_executor_allowed(self, executor: str) -> CostDecision:
        """Generic gate by executor name. Known names:

            claude_code_cli   — always allowed
            anthropic_sdk     — gated by mode + HUMAN_CONFIG
            guardian_premium  — only premium mode + budget remaining
        """
        if executor == "claude_code_cli":
            return self._allow("claude_code_cli", "CLI is always allowed")
        if executor == "anthropic_sdk":
            if self.mode == "cheap":
                return self._deny("anthropic_sdk", "cheap mode forbids paid API")
            if not self.allowed_sdk:
                return self._deny(
                    "anthropic_sdk",
                    "HUMAN_CONFIG.cost.anthropic_sdk_api_allowed=false",
                )
            if self.today_spend >= self.daily_cap > 0:
                return self._deny(
                    "anthropic_sdk",
                    f"daily cap reached: {self.today_spend:.2f}>={self.daily_cap:.2f}",
                )
            return self._allow("anthropic_sdk", f"mode={self.mode}, within cap")
        if executor == "guardian_premium":
            if self.mode != "premium":
                return self._deny("guardian_premium", f"mode is {self.mode}, not premium")
            if not self.premium_guardian:
                return self._deny(
                    "guardian_premium",
                    "HUMAN_CONFIG.cost.premium_guardian_allowed=false",
                )
            if self.daily_cap <= 0:
                return self._deny("guardian_premium", "daily_usd_cap must be > 0")
            if self.today_spend >= self.daily_cap:
                return self._deny(
                    "guardian_premium",
                    f"daily cap reached: {self.today_spend:.2f}>={self.daily_cap:.2f}",
                )
            return self._allow("guardian_premium", "premium gate open")
        return self._deny(executor, "unknown executor")

    def is_call_allowed(self, op: str) -> CostDecision:
        """Alias for fine-grained call sites. `op` matches executor names."""
        return self.is_executor_allowed(op)

    # ----- audit ----------------------------------------------------------

    def _allow(self, op: str, reason: str) -> CostDecision:
        return CostDecision(True, reason, op, self.mode)

    def _deny(self, op: str, reason: str) -> CostDecision:
        d = CostDecision(False, reason, op, self.mode)
        self._append_audit(d)
        return d

    def _append_audit(self, d: CostDecision) -> None:
        try:
            self._audit.parent.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            line = (
                f"\n- {ts}  COST-DENY  mode={d.mode}  op={d.operation}  "
                f"reason={d.reason}"
            )
            with self._audit.open("a") as f:
                f.write(line)
        except OSError:
            pass

    # ----- HUMAN_CONFIG parsing ------------------------------------------

    @classmethod
    def _read_human_config(cls) -> dict:
        """Best-effort parser for the `cost:` and `runtime:` sections of
        HUMAN_CONFIG.md. We deliberately don't take a YAML dependency; the
        spec format is line-oriented `key: value` inside yaml fences."""
        cfg = dict(cls.DEFAULTS)
        p = human_config_path()
        if not p.exists():
            return cfg
        try:
            text = p.read_text()
        except OSError:
            return cfg
        in_cost = False
        in_runtime = False
        for raw in text.splitlines():
            line = raw.rstrip()
            stripped = line.strip()
            if stripped.startswith("cost:"):
                in_cost, in_runtime = True, False
                continue
            if stripped.startswith("runtime:"):
                in_cost, in_runtime = False, True
                continue
            if stripped.startswith(("repo:", "commands:", "notifications:", "hold:")):
                in_cost = in_runtime = False
                continue
            if in_cost:
                cls._set_kv(cfg, stripped)
            elif in_runtime:
                cls._set_kv(cfg, stripped)
        return cfg

    @staticmethod
    def _set_kv(cfg: dict, line: str) -> None:
        if not line or ":" not in line:
            return
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip("\"'")
        if not value:
            return
        if value.lower() == "true":
            cfg[key] = True
        elif value.lower() == "false":
            cfg[key] = False
        else:
            try:
                cfg[key] = float(value) if "." in value else int(value)
            except ValueError:
                cfg[key] = value
