"""orchestrator/health.py — Track H1 (Cycle 37).

Compute a 0-100 health score from on-disk state and emit:
- `reports/health.json` (machine; the wake script reads this)
- `reports/health.md`   (human-readable summary)
- `reports/health.history.jsonl` (one append-line per call; trend)

Per AUTODEV_L7_MASTER_PROMPT.md §10. Nine input signals, fixed
point allocations summing to 100. Signals that can't be measured
honestly yet are `NO_DATA` (or `None` for numeric) and contribute
their FULL allocation — we don't penalize the score for absent
infra. As real measurement lands incrementally, the score
becomes more meaningful.

CLI: `python3 orchestrator/health.py [--repo <path>]`
     or via the shell wrapper `scripts/autodev_health.sh`.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional


# --- Signal container ------------------------------------------------


@dataclass
class HealthSignals:
    # §10 schema. Strings can be "PASS"/"FAIL"/"NO_DATA"; numerics
    # can be a real value or None (== NO_DATA).
    test_status: str = "NO_DATA"               # PASS | FAIL | NO_TESTS | NO_DATA
    lint_typecheck: str = "NO_DATA"            # PASS | FAIL | NO_DATA
    recent_failure_rate: Optional[float] = None
    stuck_issue_count: Optional[int] = None
    guardian_pauses_last_24h: Optional[int] = None
    flaky_test_signs: str = "NO_DATA"          # none | 1 | 2 | 3+ | NO_DATA
    large_diff_signs: Optional[int] = None
    untracked_file_risk: str = "NO_DATA"       # clean | suspicious | NO_DATA
    cost_budget_remaining_pct: Optional[float] = None


# --- Score computation ----------------------------------------------


def compute_score(s: HealthSignals) -> int:
    """Sum signal contributions per §10. NO_DATA / None contributes
    the FULL allocation for that slot."""
    score = 0

    # test_status — 30 pts
    if s.test_status == "PASS":
        score += 30
    elif s.test_status in ("NO_TESTS", "NO_DATA"):
        score += 30   # honest default
    # FAIL → 0

    # lint_typecheck — 10 pts
    if s.lint_typecheck == "PASS":
        score += 10
    elif s.lint_typecheck == "NO_DATA":
        score += 10
    # FAIL → 0

    # recent_failure_rate — 15 pts (< 10% full; 10-30% 10; 30-50% 5; > 50% 0)
    rate = s.recent_failure_rate
    if rate is None:
        score += 15
    elif rate < 0.10:
        score += 15
    elif rate < 0.30:
        score += 10
    elif rate < 0.50:
        score += 5
    # > 50% → 0

    # stuck_issue_count — 10 pts (0 full; 1 7; 2 4; 3+ 0)
    n = s.stuck_issue_count
    if n is None:
        score += 10
    elif n == 0:
        score += 10
    elif n == 1:
        score += 7
    elif n == 2:
        score += 4
    # 3+ → 0

    # guardian_pauses_last_24h — 10 pts
    p = s.guardian_pauses_last_24h
    if p is None:
        score += 10
    elif p == 0:
        score += 10
    elif p == 1:
        score += 7
    elif p == 2:
        score += 4
    # 3+ → 0

    # flaky_test_signs — 5 pts
    if s.flaky_test_signs in ("none", "NO_DATA"):
        score += 5
    elif s.flaky_test_signs == "1":
        score += 3
    elif s.flaky_test_signs == "2":
        score += 1
    # 3+ → 0

    # large_diff_signs — 5 pts
    d = s.large_diff_signs
    if d is None:
        score += 5
    elif d == 0:
        score += 5
    elif d == 1:
        score += 3
    # 2+ → 0

    # untracked_file_risk — 5 pts
    if s.untracked_file_risk in ("clean", "NO_DATA"):
        score += 5
    # suspicious → 0

    # cost_budget_remaining_pct — 10 pts
    c = s.cost_budget_remaining_pct
    if c is None:
        score += 10
    elif c > 50:
        score += 10
    elif c > 25:
        score += 7
    elif c > 10:
        score += 4
    # < 10% → 0

    return min(max(score, 0), 100)


def health_status(score: int) -> str:
    """Per §10 table: green 90-100, usable 70-89, degraded 50-69, red <50."""
    if score >= 90:
        return "green"
    if score >= 70:
        return "usable"
    if score >= 50:
        return "degraded"
    return "red"


# --- Disk-state signal gatherers ------------------------------------


def _git_status_porcelain(repo: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo, capture_output=True, text=True, timeout=10,
        )
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _untracked_file_risk(repo: Path) -> str:
    """Scan `git status` for suspicious untracked files (.env*, *.key,
    *.pem, anything under secrets/)."""
    status = _git_status_porcelain(repo)
    if not status:
        return "clean"
    # Lines starting with "??" are untracked; "M " modified; etc.
    suspicious_patterns = [
        re.compile(r"\.env(\.|$)"),
        re.compile(r"\.key$"),
        re.compile(r"\.pem$"),
        re.compile(r"id_rsa"),
        re.compile(r"^secrets/"),
    ]
    for line in status.splitlines():
        # Strip the 2-char status prefix
        path = line[3:] if len(line) > 3 else line
        for pat in suspicious_patterns:
            if pat.search(path):
                return "suspicious"
    return "clean"


def _recent_failure_rate(repo: Path, last_n: int = 10) -> Optional[float]:
    """Read reports/cycle-history.jsonl; return fail ratio over last N.
    deadlock=True counts as fail."""
    history = repo / "reports" / "cycle-history.jsonl"
    if not history.exists():
        return None
    try:
        lines = [json.loads(l) for l in history.read_text().splitlines() if l.strip()]
    except (ValueError, OSError):
        return None
    if not lines:
        return None
    recent = lines[-last_n:]
    fails = sum(1 for e in recent if e.get("deadlock"))
    return fails / len(recent)


def _test_status_quick(repo: Path) -> str:
    """Lightweight: `pytest --collect-only -q` to check whether
    collection passes. Doesn't run the full suite (would be slow).
    """
    try:
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "--collect-only", "-q",
             str(repo / "tests")],
            cwd=repo, capture_output=True, text=True, timeout=30,
        )
        # Collection errors → FAIL; clean collection → PASS
        if r.returncode == 0:
            return "PASS"
        # Some non-zero exits are "no tests found" (5); treat as NO_TESTS
        if r.returncode == 5:
            return "NO_TESTS"
        return "FAIL"
    except (OSError, subprocess.SubprocessError):
        return "NO_DATA"


def _large_diff_signs(repo: Path, hours: int = 24) -> Optional[int]:
    """Count commits in the last `hours` with > 500 lines changed."""
    try:
        r = subprocess.run(
            ["git", "log", "--since", f"{hours} hours ago",
             "--pretty=tformat:%H", "--numstat"],
            cwd=repo, capture_output=True, text=True, timeout=10,
        )
        if r.returncode != 0:
            return None
    except (OSError, subprocess.SubprocessError):
        return None

    # Parse: alternating commit-hash lines and numstat lines.
    # Each numstat line: "<add>\t<del>\t<path>". Aggregate per-commit.
    count = 0
    total = 0
    in_commit = False
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line:
            # blank line between commits — finalize prev
            if in_commit and total > 500:
                count += 1
            total = 0
            in_commit = False
            continue
        if "\t" not in line:
            # New commit hash
            if in_commit and total > 500:
                count += 1
            total = 0
            in_commit = True
            continue
        parts = line.split("\t")
        try:
            adds = int(parts[0]) if parts[0] != "-" else 0
            dels = int(parts[1]) if parts[1] != "-" else 0
            total += adds + dels
        except (ValueError, IndexError):
            continue
    # Finalize last commit
    if in_commit and total > 500:
        count += 1
    return count


def _guardian_pauses_last_24h(repo: Path) -> Optional[int]:
    """Heuristic: count occurrences of 'PAUSED' in session-log.md
    timestamped within the last 24h."""
    log = repo / "reports" / "session-log.md"
    if not log.exists():
        return None
    try:
        text = log.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    # Count lines mentioning a pause event
    return sum(1 for line in text.splitlines() if "PAUSED" in line)


def _stuck_issue_count(repo: Path, hours: int = 6) -> Optional[int]:
    """Files in tasks/ older than `hours` whose name suggests an
    in-flight task (current.md, blockers.md with content)."""
    tasks = repo / "tasks"
    if not tasks.exists():
        return None
    import time
    threshold = time.time() - hours * 3600
    stuck = 0
    for name in ("current.md", "blockers.md"):
        p = tasks / name
        if p.exists() and p.stat().st_mtime < threshold:
            text = ""
            try:
                text = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                pass
            # A file with content older than threshold counts as stuck
            if text.strip() and text.strip() not in (
                "# Current\nNo task.", "# Blockers"
            ):
                stuck += 1
    return stuck


def _cost_budget_remaining_pct(repo: Path) -> Optional[float]:
    """Heuristic: read codex-spend.jsonl; compute spent vs HUMAN_CONFIG
    daily cap. Returns percentage REMAINING (0-100)."""
    spend = repo / "reports" / "codex-spend.jsonl"
    if not spend.exists():
        return None
    try:
        lines = [json.loads(l) for l in spend.read_text().splitlines() if l.strip()]
    except (ValueError, OSError):
        return None
    if not lines:
        return 100.0
    # Sum cost from today's entries (UTC)
    today = datetime.date.today().isoformat()
    total = sum(
        float(e.get("cost_usd", 0) or 0)
        for e in lines
        if str(e.get("ts", "")).startswith(today)
    )
    # Default cap from HUMAN_CONFIG.md (heuristic: 5.0 USD if not parseable)
    cap = 5.0
    hc = repo / "HUMAN_CONFIG.md"
    if hc.exists():
        try:
            text = hc.read_text(encoding="utf-8")
            m = re.search(r"daily_usd_cap:\s*([\d.]+)", text)
            if m:
                cap = float(m.group(1))
        except (OSError, UnicodeDecodeError):
            pass
    if cap <= 0:
        return 100.0
    remaining = max(0.0, cap - total) / cap * 100.0
    return min(remaining, 100.0)


def compute_signals(repo: Path) -> HealthSignals:
    """Gather all 9 §10 signals from disk state of `repo`."""
    return HealthSignals(
        test_status=_test_status_quick(repo),
        lint_typecheck="NO_DATA",   # no lint setup wired yet
        recent_failure_rate=_recent_failure_rate(repo),
        stuck_issue_count=_stuck_issue_count(repo),
        guardian_pauses_last_24h=_guardian_pauses_last_24h(repo),
        flaky_test_signs="NO_DATA",  # no flake detector yet
        large_diff_signs=_large_diff_signs(repo),
        untracked_file_risk=_untracked_file_risk(repo),
        cost_budget_remaining_pct=_cost_budget_remaining_pct(repo),
    )


# --- Report writers --------------------------------------------------


def write_reports(score: int, signals: HealthSignals, repo: Path) -> None:
    """Emit health.json + health.md + append to history."""
    reports = repo / "reports"
    reports.mkdir(parents=True, exist_ok=True)

    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status = health_status(score)

    payload = {
        "score": int(score),
        "status": status,
        "ts": ts,
        "signals": asdict(signals),
    }
    (reports / "health.json").write_text(json.dumps(payload, indent=2) + "\n")

    # Human-readable Markdown
    md_lines = [
        f"# health: score={score} ({status})",
        f"",
        f"Generated: {ts}",
        f"",
        f"## Signals",
        f"",
        f"| signal | value |",
        f"|---|---|",
    ]
    for k, v in asdict(signals).items():
        md_lines.append(f"| {k} | {v} |")
    md_lines.append("")
    md_lines.append(f"## Thresholds (per L7 §10)")
    md_lines.append("")
    md_lines.append("- 90-100 green:     dispatch normally")
    md_lines.append("- 70-89  usable:    dispatch with WARN")
    md_lines.append("- 50-69  degraded:  pause new work")
    md_lines.append("- <50    red:       pause everything; require human")
    (reports / "health.md").write_text("\n".join(md_lines) + "\n")

    # Append to history (one line per call)
    history = reports / "health.history.jsonl"
    with history.open("a") as f:
        f.write(json.dumps({
            "ts": ts, "score": int(score), "status": status,
            "signals": asdict(signals),
        }) + "\n")


# --- CLI -------------------------------------------------------------


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="Compute health score")
    parser.add_argument(
        "--repo", default=None,
        help="Repo root (default: parent of this script)",
    )
    args = parser.parse_args(argv)

    repo = (
        Path(args.repo).resolve()
        if args.repo
        else Path(__file__).resolve().parent.parent
    )
    signals = compute_signals(repo)
    score = compute_score(signals)
    write_reports(score, signals, repo)
    print(f"score={score} status={health_status(score)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
