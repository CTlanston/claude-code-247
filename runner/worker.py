"""Per-task worker driver.

This is the program that runs inside a runner container (or, for the
`local` backend, in a subprocess on the host). It walks the per-task
workflow:

  1. Read the task spec (path or stdin).
  2. Confirm the workspace + branch are ready.
  3. Run the repo's test / lint / build commands; capture outputs.
  4. Snapshot the diff + file manifest.
  5. Emit an evidence package into <workspace>/.evidence/.
  6. Exit 0 on success, non-zero on any captured failure.

Claude Code role invocations (planner/coder/reviewer/repair) land in M4
through ``runner.prompt_builder``; this M3 driver is the framework they
plug into. Until then the role steps are skipped with a recorded reason.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runner.evidence_collector import EvidenceCollector


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser("runner.worker")
    parser.add_argument("--task-spec", type=str, default="-",
                        help="Path to task spec JSON, or '-' to read stdin.")
    parser.add_argument("--workspace", type=str, required=True)
    parser.add_argument("--allow-roles", action="store_true",
                        help="When set, attempt the Claude Code role steps (M4+).")
    args = parser.parse_args(argv)

    spec = _read_spec(args.task_spec)
    workspace = Path(args.workspace).expanduser().resolve()
    if not workspace.exists():
        print(f"workspace missing: {workspace}", file=sys.stderr)
        return 2

    collector = EvidenceCollector(workspace=workspace, task_spec=spec)
    collector.write_contract()

    # M3 scope: shell-out the configured commands and collect evidence.
    commands = spec.get("commands") or {}
    test_results = collector.run_named_commands("test", commands.get("test") or [])
    lint_results = collector.run_named_commands("lint", commands.get("lint") or [])
    build_results = collector.run_named_commands("build", commands.get("build") or [])

    collector.snapshot_diff()
    collector.snapshot_manifest()
    summary = {
        "test": test_results,
        "lint": lint_results,
        "build": build_results,
        "diff_path": str(collector.evidence_dir / "diff_summary.md"),
    }
    collector.write_summary(summary)

    any_failed = any(
        r["exit"] != 0
        for group in (test_results, lint_results, build_results)
        for r in group
    )

    if not args.allow_roles:
        collector.write_worker_done({
            "ok": not any_failed,
            "role_steps": "skipped (M3 driver; roles ship in M4)",
            "summary": summary,
        })
        return 1 if any_failed else 0

    # M4 will fill these in with planner/coder/reviewer/repair invocations.
    collector.write_worker_done({
        "ok": not any_failed,
        "role_steps": "not yet implemented at runner level",
        "summary": summary,
    })
    return 1 if any_failed else 0


def _read_spec(path: str) -> dict:
    if path == "-":
        data = sys.stdin.read()
    else:
        data = Path(path).read_text(encoding="utf-8")
    return json.loads(data)


if __name__ == "__main__":
    sys.exit(main())
