"""Evidence package builder.

Per spec §9.3, each task's ``<workspace>/.evidence/`` contains:

  contract.md
  plan.md                (M4 — planner)
  worker_done.md
  diff_summary.md
  diff_body_safe.md      (M19/BR-001 — redacted body for validators)
  diff_body_metadata.json (M19/BR-001 — files_changed + secret_scan)
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
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from orchestrator.secret_scanner import scan as _scan_secrets
from orchestrator.worker_exits import classify_failure, record_worker_exit

# Default forbidden glob patterns. The task spec may extend this list,
# never replace it — these are the floor enforced by the system itself
# (per CLAUDE.md §Non-negotiables 3).
DEFAULT_FORBIDDEN_PATTERNS: tuple[str, ...] = (
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "secrets/**",
    "**/secrets/**",
    ".github/**",
    "CLAUDE.md",
    "AGENTS.md",
    "*.pem",
    "*.key",
    "**/*.pem",
    "**/*.key",
    "id_rsa",
    "id_rsa.pub",
    "**/id_rsa",
    "**/id_rsa.pub",
)

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
        <kind>_results.json. Returns the same payload.

        M19/BR-003: each command's outcome also writes a row to the
        ``worker_exits`` table when the task spec carries task_id +
        repo_id. The recording is best-effort — observability is never
        allowed to break the worker."""
        results: list[dict[str, Any]] = []
        phase = _PHASE_FOR_KIND.get(kind, kind)
        task_id = self.task_spec.get("task_id")
        repo_id = self.task_spec.get("repo_id")
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
            if task_id and repo_id:
                _record_phase_exit(
                    task_id=task_id, repo_id=repo_id, phase=phase,
                    result=results[-1], duration_s=time.time() - t0,
                )
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

    def snapshot_diff_body_safe(
        self,
        *,
        forbidden_paths: list[str] | None = None,
        max_total_bytes: int = 256_000,
        max_per_file_bytes: int = 64_000,
        base_ref: str = "HEAD",
    ) -> tuple[Path, Path]:
        """Produce a redacted, size-limited diff body for validator input.

        BR-001: validators were previously given only the ``--stat`` summary,
        which isn't enough evidence to verify behavioral correctness on
        anything subtler than file-counts. This method emits the textual
        diff body with safety filters applied so the validator can actually
        see what changed.

        Safety:
          - Forbidden paths (defaults + task spec) are listed in metadata
            but their per-file diff hunks are omitted from the body.
          - If any secret-like value is detected anywhere in the included
            diffs, the whole body is replaced with a REDACTED notice and
            metadata.secret_scan.status is set to ``BLOCKED`` (per
            directive §Security rule: "evidence should contain redacted
            summary only").
          - Per-file and total byte caps with a truncation marker.

        Returns:
            (diff_body_safe_path, diff_body_metadata_path)
        """
        forbidden = list(DEFAULT_FORBIDDEN_PATTERNS)
        if forbidden_paths:
            forbidden.extend(forbidden_paths)
        compiled = [re.compile(_glob_to_regex(p)) for p in forbidden]

        # Collect file-level metadata. We need both numstat (add/del counts)
        # and name-status (status code) — they don't combine cleanly into a
        # single git command for renames + binary edits, so run both.
        files_changed: list[dict[str, Any]] = []
        try:
            numstat = subprocess.run(
                ["git", "diff", "--numstat", base_ref],
                cwd=str(self.workspace),
                capture_output=True, text=True, timeout=30,
            )
            name_status = subprocess.run(
                ["git", "diff", "--name-status", base_ref],
                cwd=str(self.workspace),
                capture_output=True, text=True, timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as e:
            body = (
                "# Safe diff body\n\nFailed to capture diff body: "
                f"{type(e).__name__}: {e}\n"
            )
            diff_body_path = self._write_text("diff_body_safe.md", body)
            metadata_path = self._write_text(
                "diff_body_metadata.json",
                json.dumps({
                    "task_id": self.task_spec.get("task_id"),
                    "repo_id": self.task_spec.get("repo_id"),
                    "base_ref": base_ref,
                    "files_changed": [],
                    "diff_body_safe_path": ".evidence/diff_body_safe.md",
                    "diff_body_truncated": False,
                    "secret_scan": {"status": "PASS", "hits": []},
                    "error": f"{type(e).__name__}: {e}",
                }, indent=2, sort_keys=True),
            )
            return diff_body_path, metadata_path

        status_map: dict[str, str] = {}
        for line in (name_status.stdout or "").splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            code = parts[0]
            path = parts[-1].strip()
            status_map[path] = _STATUS_NAMES.get(code[:1], code)

        per_file_bodies: list[tuple[str, str]] = []
        all_hits: list[dict[str, Any]] = []
        truncated = False
        running_bytes = 0

        for line in (numstat.stdout or "").splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            adds_s, dels_s, path = parts[0], parts[1], parts[2].strip()
            additions = int(adds_s) if adds_s.isdigit() else 0
            deletions = int(dels_s) if dels_s.isdigit() else 0

            omitted_reason: str | None = None
            if any(rx.match(path) for rx in compiled):
                omitted_reason = "forbidden_path_match"
            included = omitted_reason is None

            entry: dict[str, Any] = {
                "path": path,
                "status": status_map.get(path, "modified"),
                "additions": additions,
                "deletions": deletions,
                "included_in_diff_body": included,
                "omitted_reason": omitted_reason,
            }

            if not included:
                files_changed.append(entry)
                continue

            try:
                pf = subprocess.run(
                    ["git", "diff", base_ref, "--", path],
                    cwd=str(self.workspace),
                    capture_output=True, text=True, timeout=30,
                )
                file_diff = pf.stdout
            except (OSError, subprocess.SubprocessError) as e:
                file_diff = f"(failed to read diff for {path}: {e})\n"

            hits = _scan_secrets(file_diff)
            if hits:
                all_hits.extend(
                    {"path": path, "pattern": h.pattern, "line_no": h.line_no}
                    for h in hits
                )

            file_bytes = len(file_diff.encode("utf-8"))
            if file_bytes > max_per_file_bytes:
                file_diff = (
                    file_diff[:max_per_file_bytes]
                    + f"\n[TRUNCATED: per-file cap {max_per_file_bytes} bytes]\n"
                )
                truncated = True
                entry["truncated"] = True

            file_bytes = len(file_diff.encode("utf-8"))
            if running_bytes + file_bytes > max_total_bytes:
                truncated = True
                entry["included_in_diff_body"] = False
                entry["omitted_reason"] = "total_size_cap"
                files_changed.append(entry)
                continue

            per_file_bodies.append((path, file_diff))
            running_bytes += file_bytes
            files_changed.append(entry)

        # Compose body.
        if all_hits:
            patterns = sorted({h["pattern"] for h in all_hits})
            body = (
                "# Safe diff body — REDACTED\n\n"
                "Secret-like content was detected in this diff. Per the\n"
                "system security rule (CLAUDE.md §Non-negotiables 1; M19\n"
                "BR-001 directive §Security rule), the full diff body is\n"
                "suppressed and only file-level metadata is exposed below.\n"
                "The merge policy MUST refuse this PR regardless of\n"
                "validator verdict.\n\n"
                f"- Secret-scan hits: {len(all_hits)}\n"
                f"- Patterns observed: {', '.join(patterns)}\n"
                "- Affected paths: "
                f"{sorted({h['path'] for h in all_hits})}\n"
            )
            secret_status = "BLOCKED"
        else:
            parts_out: list[str] = ["# Safe diff body\n\n"]
            parts_out.append(
                "Unified diff for changed allowed files. Forbidden paths\n"
                "are listed in diff_body_metadata.json with `included_in_diff_body=false`.\n"
            )
            if truncated:
                parts_out.append("\n*Note: diff body was truncated to respect size caps.*\n")
            if not per_file_bodies:
                parts_out.append("\n(no allowed-file changes)\n")
            else:
                for path, diff_text in per_file_bodies:
                    parts_out.append(f"\n### `{path}`\n\n```diff\n{diff_text}\n```\n")
            body = "".join(parts_out)
            secret_status = "PASS"

        diff_body_path = self._write_text("diff_body_safe.md", body)
        metadata = {
            "task_id": self.task_spec.get("task_id"),
            "repo_id": self.task_spec.get("repo_id"),
            "base_ref": base_ref,
            "head_ref": "HEAD",
            "files_changed": files_changed,
            "diff_body_safe_path": ".evidence/diff_body_safe.md",
            "diff_body_truncated": truncated,
            "secret_scan": {"status": secret_status, "hits": all_hits},
        }
        metadata_path = self._write_text(
            "diff_body_metadata.json",
            json.dumps(metadata, indent=2, sort_keys=True),
        )
        return diff_body_path, metadata_path

    # ── internals ────────────────────────────────────────────────────

    def _write_text(self, name: str, body: str) -> Path:
        p = self.evidence_dir / name
        p.write_text(body, encoding="utf-8")
        return p


def _tail(s: str, n: int) -> str:
    return s[-n:] if len(s) > n else s


_PHASE_FOR_KIND: dict[str, str] = {
    "test": "tests",
    "lint": "lint",
    "build": "build",
}


def _record_phase_exit(
    *,
    task_id: str,
    repo_id: str,
    phase: str,
    result: dict[str, Any],
    duration_s: float,
) -> None:
    """Best-effort write of a worker_exits row for one command.

    Observability must never bring down the worker, so we swallow any
    DB-side failure (uninitialised schema, busy lock, missing state
    dir) — the rest of the pipeline still has the in-memory ``result``
    dict + the on-disk <kind>_results.json.
    """
    try:
        classification = classify_failure(
            phase=phase,
            exit_code=result.get("exit"),
            command=result.get("cmd"),
            stderr_tail=result.get("stderr_tail"),
        )
        record_worker_exit(
            task_id=task_id, repo_id=repo_id,
            worker_role="runner", phase=phase,
            classification=classification,
            command=result.get("cmd"),
            exit_code=result.get("exit"),
            duration_ms=int(duration_s * 1000),
            stdout_tail=result.get("stdout_tail"),
            stderr_tail=result.get("stderr_tail"),
            retryable=classification in (
                "test_failure", "lint_failure", "claude_cli_failure", "timeout",
            ),
        )
    except Exception:  # pragma: no cover — observability is best-effort
        pass


_STATUS_NAMES: dict[str, str] = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "typechange",
    "U": "unmerged",
    "X": "unknown",
}


def _glob_to_regex(pat: str) -> str:
    """Minimal glob-to-regex.

    ``**`` matches any chars including ``/``; ``*`` matches any chars
    except ``/``; ``?`` matches any single char. Other regex metachars
    are escaped. Anchored at both ends.
    """
    out: list[str] = []
    i = 0
    while i < len(pat):
        c = pat[i]
        if c == "*" and i + 1 < len(pat) and pat[i + 1] == "*":
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c in r".+()[]{}|^$\\":
            out.append("\\" + c)
            i += 1
        else:
            out.append(c)
            i += 1
    return "^" + "".join(out) + "$"
