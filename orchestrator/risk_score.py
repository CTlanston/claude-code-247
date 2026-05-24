"""PR risk scoring — 0..100.

Inputs come from the runner's evidence package (diff stats, test/lint
results), the validator outputs, and the repo's allowed/forbidden_paths.
Factor weights live in ``config/policies.yaml`` so the operator can tune
without code changes.

Returns a ``RiskAssessment`` that ``merge_policy.decide`` consumes.
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from typing import Any

from orchestrator.config import load_config
from validator.judge_contract import JudgeResult

SENSITIVE_PATH_PATTERNS = (
    "**/*.lock",            # lockfiles (Cargo, package-lock, uv.lock...)
    "**/poetry.lock",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/Pipfile.lock",
    "**/migrations/**",     # alembic / django / generic
    "**/schema.sql",
)
AUTH_SECURITY_PATTERNS = (
    "**/auth/**", "**/security/**", "**/permission*", "**/permissions/**",
    "**/login*", "**/credential*", "**/token*",
)
NETWORK_PATTERNS = (
    "**/requests/**", "**/network/**", "**/api/**", "**/client/**",
    "**/*.proto",
)
ORCH_CORE_PATTERNS = ("orchestrator/**",)
RUNNER_PATTERNS = ("runner/**",)
VALIDATOR_PATTERNS = ("validator/**",)
WORKFLOW_PATTERNS = (".github/**",)
DEPENDENCY_PATTERNS = (
    "pyproject.toml", "requirements*.txt", "package.json", "Cargo.toml",
    "go.mod", "Gemfile", "**/poetry.lock", "**/package-lock.json",
)


@dataclass(frozen=True)
class DiffStats:
    files: list[str]
    insertions: int
    deletions: int

    @property
    def total_lines(self) -> int:
        return self.insertions + self.deletions

    @classmethod
    def from_git_numstat(cls, text: str) -> "DiffStats":
        """Parse ``git diff --numstat`` output.
        Each line: ``<ins>\\t<del>\\t<path>`` (binary files use '-')."""
        files: list[str] = []
        ins = 0
        dels = 0
        for line in text.splitlines():
            parts = line.rstrip().split("\t")
            if len(parts) < 3:
                continue
            try:
                ins_l = int(parts[0]) if parts[0] != "-" else 0
                del_l = int(parts[1]) if parts[1] != "-" else 0
            except ValueError:
                continue
            files.append(parts[2])
            ins += ins_l
            dels += del_l
        return cls(files=files, insertions=ins, deletions=dels)


@dataclass
class RiskFactor:
    name: str
    weight: int
    reason: str
    triggered: bool


@dataclass
class RiskAssessment:
    score: int                         # clamped 0..100
    level: str                         # low|medium|high
    factors: list[RiskFactor] = field(default_factory=list)
    triggered: list[RiskFactor] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "level": self.level,
            "triggered": [{"name": f.name, "weight": f.weight, "reason": f.reason}
                          for f in self.triggered],
            "notes": list(self.notes),
        }


def _matches_any(path: str, patterns) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in patterns)


def _has_test_changes(files: list[str]) -> bool:
    return any(re.search(r"(^|/)tests?/", f) or "_test" in f or "test_" in f
               for f in files)


def _has_code_changes(files: list[str]) -> bool:
    return any(
        not (re.search(r"(^|/)tests?/", f) or "_test" in f or "test_" in f)
        and f.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java", ".rb"))
        for f in files
    )


def _level_for(score: int, policies: dict) -> str:
    levels = (policies.get("risk_levels") or {})
    low_max = int(levels.get("low_max", 30))
    medium_max = int(levels.get("medium_max", 70))
    if score <= low_max:
        return "low"
    if score <= medium_max:
        return "medium"
    return "high"


def compute_risk(
    diff: DiffStats,
    *,
    allowed_paths: list[str],
    forbidden_paths: list[str],
    validators: list[JudgeResult] | None = None,
    ci_passed: bool | None = None,
    test_results: list[dict] | None = None,
    lint_results: list[dict] | None = None,
    policies: dict | None = None,
) -> RiskAssessment:
    cfg = load_config()
    pol = policies if policies is not None else cfg.policies
    factor_defs = (pol.get("risk_score") or {}).get("factors") or {}

    test_results = test_results or []
    lint_results = lint_results or []
    validators = validators or []

    notes: list[str] = []
    factors: list[RiskFactor] = []

    def add(name: str, triggered: bool, reason: str) -> None:
        spec = factor_defs.get(name) or {}
        w = int(spec.get("weight", 0))
        factors.append(RiskFactor(name=name, weight=w, reason=reason, triggered=triggered))

    # ── size factors with per-50-line / per-3-file scaling ──────────
    per50 = factor_defs.get("changed_lines_per_50") or {}
    per50_weight = int(per50.get("weight", 0))
    per50_ceiling = int(per50.get("ceiling", per50_weight))
    lines_buckets = max(0, (diff.total_lines + 49) // 50 - 1)
    lines_score = min(per50_ceiling, lines_buckets * per50_weight)
    factors.append(RiskFactor(
        "changed_lines_per_50", lines_score,
        f"{diff.total_lines} changed lines", triggered=lines_score > 0,
    ))

    per3 = factor_defs.get("files_touched_per_3") or {}
    per3_weight = int(per3.get("weight", 0))
    per3_ceiling = int(per3.get("ceiling", per3_weight))
    files_buckets = max(0, (len(diff.files) - 1) // 3)
    files_score = min(per3_ceiling, files_buckets * per3_weight)
    factors.append(RiskFactor(
        "files_touched_per_3", files_score,
        f"{len(diff.files)} files touched", triggered=files_score > 0,
    ))

    # ── path-based ─────────────────────────────────────────────────
    forbidden_hits = [f for f in diff.files if _matches_any(f, forbidden_paths)]
    add("forbidden_path_touch", bool(forbidden_hits),
        f"touched forbidden paths: {forbidden_hits[:3]}" if forbidden_hits else "no forbidden touch")

    sensitive_hits = [f for f in diff.files if _matches_any(f, SENSITIVE_PATH_PATTERNS)]
    add("sensitive_path_touch", bool(sensitive_hits),
        f"sensitive: {sensitive_hits[:3]}" if sensitive_hits else "")

    workflow_hits = [f for f in diff.files if _matches_any(f, WORKFLOW_PATTERNS)]
    add("workflow_change", bool(workflow_hits),
        f"workflow files: {workflow_hits[:3]}" if workflow_hits else "")

    dep_hits = [f for f in diff.files if _matches_any(f, DEPENDENCY_PATTERNS)]
    add("dependency_change", bool(dep_hits),
        f"dependency files: {dep_hits[:3]}" if dep_hits else "")

    auth_hits = [f for f in diff.files if _matches_any(f, AUTH_SECURITY_PATTERNS)]
    add("auth_security_files", bool(auth_hits),
        f"auth/security: {auth_hits[:3]}" if auth_hits else "")

    net_hits = [f for f in diff.files if _matches_any(f, NETWORK_PATTERNS)]
    add("network_code_change", bool(net_hits), "")

    orch_hits = [f for f in diff.files if _matches_any(f, ORCH_CORE_PATTERNS)]
    add("orchestrator_core_change", bool(orch_hits), f"{orch_hits[:3]}" if orch_hits else "")

    runner_hits = [f for f in diff.files if _matches_any(f, RUNNER_PATTERNS)]
    add("runner_sandbox_change", bool(runner_hits), f"{runner_hits[:3]}" if runner_hits else "")

    val_hits = [f for f in diff.files if _matches_any(f, VALIDATOR_PATTERNS)]
    add("validator_change", bool(val_hits), f"{val_hits[:3]}" if val_hits else "")

    # ── test/code balance ──────────────────────────────────────────
    has_code = _has_code_changes(diff.files)
    has_tests = _has_test_changes(diff.files)
    add("test_change_without_code", has_tests and not has_code,
        "test-only change" if (has_tests and not has_code) else "")
    add("code_change_without_test", has_code and not has_tests,
        "code change without tests" if (has_code and not has_tests) else "")

    # ── large deletion ─────────────────────────────────────────────
    add("large_deletion", diff.deletions > 200,
        f"large deletion: {diff.deletions} lines removed" if diff.deletions > 200 else "")

    # ── CI / validator ─────────────────────────────────────────────
    add("ci_failure", ci_passed is False, "CI failed" if ci_passed is False else "")
    verdicts = {v.verdict for v in validators}
    add("validator_disagreement", len(verdicts) > 1,
        f"validator disagreement: {[(v.validator, v.verdict) for v in validators]}"
        if len(verdicts) > 1 else "")

    # ── test failures pulled in as informational note ─────────────
    if any(r.get("exit", 0) != 0 for r in test_results):
        notes.append("one or more test commands failed")

    # ── final score: sum of triggered factor weights, clamped ─────
    triggered = [f for f in factors if f.triggered]
    score = sum(f.weight for f in triggered)
    # changed_lines_per_50 / files_touched_per_3 already contribute their
    # scaled weight; they're in `factors` with weight = the scaled score.
    # We avoid double-counting by treating their "weight" as the actual
    # contribution.
    # Clamp.
    score = max(0, min(100, score))
    level = _level_for(score, pol)
    return RiskAssessment(score=score, level=level, factors=factors,
                          triggered=triggered, notes=notes)
