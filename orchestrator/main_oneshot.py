"""One-shot entry point onto the existing inner engine.

Used by `autodev/inner_engine.py:_run_subprocess`. Imports the same modules
the long-running `main.py` uses, runs the loop body **exactly once**, then
exits. No infinite loop. No behavioural change to existing semantics —
we just call the public functions that `main.main()` would have called.

Exit code:
  0 — one cycle completed (with or without work to do)
  2 — supervisor pause / rate-limit flag is set, no work done
  3 — terminal Anthropic error (PAUSED set by main.py); supervisor should hold
  4 — uncaught exception in the inner engine
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Ensure we run with the orchestrator package importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from orchestrator import circuit_breaker as cb, db, git_proxy, main as engine
except ImportError:
    # Fallback for direct invocation (python3 orchestrator/main_oneshot.py).
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import circuit_breaker as cb  # type: ignore
    import db  # type: ignore
    import git_proxy  # type: ignore
    import main as engine  # type: ignore


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run one inner-engine tick.")
    p.add_argument("--task-id", help="optional task hint (informational only)")
    p.add_argument("--no-guardian", action="store_true",
                   help="skip guardian invocation regardless of cadence")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    log = logging.getLogger("oneshot")
    if args.task_id:
        log.info("oneshot tick (task hint=%s)", args.task_id)

    try:
        db.init()
        git_proxy.ensure_remote()
    except Exception as e:  # noqa: BLE001
        log.exception("init failed: %s", e)
        return 4

    # Honour the same pause/rate-limit flags main.main() does.
    if engine.PAUSED_FLAG.exists():
        log.warning("dispatch paused (flag=%s) — exiting oneshot", engine.PAUSED_FLAG)
        return 2
    if engine._rate_limit_active():
        log.warning("rate-limit window active — exiting oneshot")
        return 2

    try:
        cb.check_global()
    except cb.CircuitOpen as e:
        log.error("circuit open: %s", e)
        return 2

    try:
        engine.ingest_issues()
        for status in ("queued", "coding", "ci_running", "reviewing"):
            for t in db.list_tasks_by_status(status):
                engine._process_one(t)
    except Exception as e:  # noqa: BLE001
        log.exception("loop body raised: %s", e)
        return 4

    # Optional guardian — supervisor controls cadence, not us.
    if not args.no_guardian:
        try:
            engine.run_guardian()
        except Exception as e:  # noqa: BLE001
            log.warning("guardian failed (non-fatal): %s", e)

    # If main.py set PAUSED during this tick (terminal Anthropic error),
    # surface it via exit 3 so the supervisor records a hold.
    if engine.PAUSED_FLAG.exists():
        return 3

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
