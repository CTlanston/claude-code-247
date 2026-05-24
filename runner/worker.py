"""Per-task worker driver.

This is the program that runs inside a runner container (or, for the
`local` backend, in a subprocess on the host). It walks the per-task
workflow:

  1. Read the task spec (path or stdin).
  2. Confirm the workspace + branch are ready.
  3. Run the repo's test / lint / build commands; capture outputs.
  4. Snapshot the diff + file manifest.
  5. (M4) If --allow-roles, run the Planner→Coder→Reviewer→Repair loop.
  6. Emit an evidence package into <workspace>/.evidence/.
  7. Exit 0 on success, non-zero on any captured failure or NEEDS_HUMAN.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runner.evidence_collector import EvidenceCollector
from runner.role_loop import run_role_loop


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser("runner.worker")
    parser.add_argument("--task-spec", type=str, default="-",
                        help="Path to task spec JSON, or '-' to read stdin.")
    parser.add_argument("--workspace", type=str, required=True)
    parser.add_argument("--allow-roles", action="store_true",
                        help="When set, run the Claude Code role loop.")
    parser.add_argument("--claude-bin", type=str, default="claude",
                        help="Override the claude CLI binary (for tests).")
    parser.add_argument("--model", type=str, default=None,
                        help="Override model id for all role invocations.")
    parser.add_argument("--max-repair", type=int, default=3,
                        help="Max repair attempts before giving up.")
    args = parser.parse_args(argv)

    spec = _read_spec(args.task_spec)
    workspace = Path(args.workspace).expanduser().resolve()
    if not workspace.exists():
        print(f"workspace missing: {workspace}", file=sys.stderr)
        return 2

    collector = EvidenceCollector(workspace=workspace, task_spec=spec)
    collector.write_contract()

    commands = spec.get("commands") or {}

    def _run_repo_commands() -> dict[str, list]:
        return {
            "test": collector.run_named_commands("test", commands.get("test") or []),
            "lint": collector.run_named_commands("lint", commands.get("lint") or []),
            "build": collector.run_named_commands("build", commands.get("build") or []),
        }

    initial = _run_repo_commands()
    collector.snapshot_diff()
    collector.snapshot_manifest()

    if not args.allow_roles:
        any_failed = _any_failed(initial)
        collector.write_summary({
            **initial,
            "diff_path": str(collector.evidence_dir / "diff_summary.md"),
        })
        collector.write_worker_done({
            "ok": not any_failed,
            "role_steps": "skipped (no --allow-roles)",
            "summary": initial,
        })
        return 1 if any_failed else 0

    # Roles loop. The rerun_tests callback gives the Reviewer the latest
    # repo command results after the Coder / Repair changes.
    def _rerun() -> list:
        return collector.run_named_commands("test", commands.get("test") or [])

    outcome = run_role_loop(
        spec=spec,
        workspace=workspace,
        collector=collector,
        claude_bin=args.claude_bin,
        model=args.model,
        max_repair_attempts=args.max_repair,
        rerun_tests=_rerun,
    )
    collector.snapshot_diff()
    collector.snapshot_manifest()
    final_tests = collector.run_named_commands("test", commands.get("test") or [])
    summary = {
        **initial,
        "test_final": final_tests,
        "diff_path": str(collector.evidence_dir / "diff_summary.md"),
    }
    collector.write_summary(summary)
    payload = {
        "ok": outcome.ok,
        "summary": summary,
        "role_loop": outcome.to_payload(),
    }
    collector.write_worker_done(payload)
    if outcome.final_verdict == "PASS":
        return 0
    if outcome.final_verdict == "NEEDS_HUMAN":
        return 3
    return 1


def _any_failed(groups: dict[str, list]) -> bool:
    return any(r["exit"] != 0 for g in groups.values() for r in g)


def _read_spec(path: str) -> dict:
    if path == "-":
        data = sys.stdin.read()
    else:
        data = Path(path).read_text(encoding="utf-8")
    return json.loads(data)


if __name__ == "__main__":
    sys.exit(main())
