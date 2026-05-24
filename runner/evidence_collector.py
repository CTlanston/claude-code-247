"""Evidence package builder.

Per spec §9.3, each task's ``<workspace>/.evidence/`` contains:

  contract.md
  plan.md                (M4 — planner)
  worker_done.md
  diff_summary.md
  file_manifest.json
  test_results.json
  lint_results.json
  build_results.json
  risk_score.json        (M6)
  reviewer_report.md     (M4)
  ci_summary.md          (M3 emits a placeholder)

The validator (M5) reads ONLY from this directory and never sees Coder
context. We keep this module strictly file-oriented: it has no idea what
a "validator" is.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

CONTRACT_HEADER = (
    "# Contract\n\n"
    "Goal-spec the planner committed to. Validators must judge work\n"
    "against THIS document; nothing in the Coder's conversation context\n"
    "is visible to them.\n\n"
)


class EvidenceCollector:
    def __init__(self, *, workspace: Path, task_spec: dict[str, Any]) -> None:
        self.workspace = Path(workspace)
        self.task_spec = task_spec
        self.evidence_dir = self.workspace / ".evidence"
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    # ── writers ──────────────────────────────────────────────────────

    def write_contract(self) -> Path:
        body = CONTRACT_HEADER + json.dumps(
            {
                "task_id": self.task_spec.get("task_id"),
                "repo_id": self.task_spec.get("repo_id"),
                "goal": self.task_spec.get("goal"),
                "allowed_paths": self.task_spec.get("allowed_paths"),
                "forbidden_paths": self.task_spec.get("forbidden_paths"),
            },
            indent=2,
            sort_keys=True,
        )
        return self._write_text("contract.md", body)

    def write_worker_done(self, payload: dict[str, Any]) -> Path:
        body = (
            "# worker_done\n\n"
            "Result of the M3 worker pass over the repo. Validators read\n"
            "this together with the diff / test outputs to decide PASS / FAIL.\n\n"
            "```json\n" + json.dumps(payload, indent=2, sort_keys=True) + "\n```\n"
        )
        return self._write_text("worker_done.md", body)

    def write_summary(self, summary: dict[str, Any]) -> Path:
        return self._write_text(
            "summary.json", json.dumps(summary, indent=2, sort_keys=True)
        )

    # ── runners ──────────────────────────────────────────────────────

    def run_named_commands(self, kind: str, commands: list[str]) -> list[dict[str, Any]]:
        """Run a list of shell commands inside the workspace and emit
        <kind>_results.json. Returns the same payload."""
        results: list[dict[str, Any]] = []
        for cmd in commands:
            t0 = time.time()
            try:
                proc = subprocess.run(
                    ["/bin/sh", "-c", cmd],
                    cwd=str(self.workspace),
                    capture_output=True,
                    text=True,
                    timeout=900,
                )
                results.append({
                    "cmd": cmd,
                    "exit": proc.returncode,
                    "stdout_tail": _tail(proc.stdout, 4_000),
                    "stderr_tail": _tail(proc.stderr, 4_000),
                    "duration_s": round(time.time() - t0, 3),
                })
            except subprocess.TimeoutExpired as e:
                results.append({
                    "cmd": cmd,
                    "exit": 124,
                    "stdout_tail": _tail(e.stdout or "", 4_000),
                    "stderr_tail": "TIMEOUT after 900s",
                    "duration_s": round(time.time() - t0, 3),
                })
            except (OSError, subprocess.SubprocessError) as e:
                results.append({
                    "cmd": cmd,
                    "exit": -1,
                    "stdout_tail": "",
                    "stderr_tail": f"{type(e).__name__}: {e}",
                    "duration_s": round(time.time() - t0, 3),
                })
        self._write_text(f"{kind}_results.json", json.dumps(results, indent=2))
        return results

    # ── git snapshots ────────────────────────────────────────────────

    def snapshot_diff(self) -> Path:
        try:
            diff = subprocess.run(
                ["git", "diff", "--stat", "HEAD"],
                cwd=str(self.workspace),
                capture_output=True, text=True, timeout=30,
            )
            body = "# Diff summary\n\n```\n" + (diff.stdout or "(no diff)") + "\n```\n"
        except (OSError, subprocess.SubprocessError) as e:
            body = f"# Diff summary\n\nFailed to capture: {e}\n"
        return self._write_text("diff_summary.md", body)

    def snapshot_manifest(self) -> Path:
        manifest: list[str] = []
        for p in sorted(self.workspace.rglob("*")):
            if ".git" in p.parts or ".evidence" in p.parts:
                continue
            if p.is_file():
                manifest.append(str(p.relative_to(self.workspace)))
        return self._write_text(
            "file_manifest.json", json.dumps(manifest, indent=2)
        )

    # ── internals ────────────────────────────────────────────────────

    def _write_text(self, name: str, body: str) -> Path:
        p = self.evidence_dir / name
        p.write_text(body, encoding="utf-8")
        return p


def _tail(s: str, n: int) -> str:
    return s[-n:] if len(s) > n else s
