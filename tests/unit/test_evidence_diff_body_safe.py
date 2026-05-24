"""BR-001 — EvidenceCollector.snapshot_diff_body_safe.

Produces a safe diff body that validators can use as implementation
evidence. Must:

  1. Include diffs of allowed files only.
  2. Omit forbidden paths (.env, secrets/**, .github/**, CLAUDE.md, etc.,
     plus any patterns from the task spec).
  3. Redact lines containing secret-like values (full body suppressed,
     not just per-line — directive §Security rule).
  4. Apply per-file + total size caps with a truncation marker.
  5. Emit diff_body_metadata.json with files_changed + secret_scan status.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from runner.evidence_collector import EvidenceCollector


def _init_repo(workspace: Path) -> None:
    subprocess.run(["git", "init", "-q", "-b", "main", str(workspace)], check=True)


def _commit_initial(workspace: Path, files: dict[str, str]) -> None:
    for rel, content in files.items():
        full = workspace / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content)
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    }
    subprocess.run(["git", "-C", str(workspace), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(workspace), "commit", "-q", "-m", "init"],
        check=True, env=env,
    )


def _modify(workspace: Path, rel: str, content: str) -> None:
    full = workspace / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)


def test_allowed_file_diff_included(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"src/foo.py": "x = 1\n"})
    _modify(tmp_path, "src/foo.py", "x = 1\ny = 2\n")

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()

    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    assert "src/foo.py" in body
    assert "+y = 2" in body
    foo = next(f for f in meta["files_changed"] if f["path"] == "src/foo.py")
    assert foo["included_in_diff_body"] is True
    assert foo["omitted_reason"] is None
    assert foo["additions"] >= 1
    assert meta["secret_scan"]["status"] == "PASS"


def test_default_forbidden_paths_omitted(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {
        "src/foo.py": "x = 1\n",
        ".env": "OLD=1\n",
        "secrets/keys.txt": "old\n",
    })
    _modify(tmp_path, ".env", "OLD=1\nNEW=2\n")
    _modify(tmp_path, "secrets/keys.txt", "old\nnew\n")
    _modify(tmp_path, "src/foo.py", "x = 2\n")

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()
    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    # Body must NOT contain the modified content of forbidden files
    assert "NEW=2" not in body
    assert "secrets/keys.txt" not in body or "[OMITTED" in body
    # Metadata records them as omitted, with a reason
    env_e = next(f for f in meta["files_changed"] if f["path"] == ".env")
    sec_e = next(f for f in meta["files_changed"] if f["path"] == "secrets/keys.txt")
    assert env_e["included_in_diff_body"] is False
    assert env_e["omitted_reason"]
    assert sec_e["included_in_diff_body"] is False
    assert sec_e["omitted_reason"]
    # Allowed file still included
    foo = next(f for f in meta["files_changed"] if f["path"] == "src/foo.py")
    assert foo["included_in_diff_body"] is True


def test_spec_forbidden_paths_extend_defaults(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"vendor/lib.py": "old\n", "src/foo.py": "x = 1\n"})
    _modify(tmp_path, "vendor/lib.py", "old\nNEW_VENDOR_LINE\n")
    _modify(tmp_path, "src/foo.py", "x = 2\n")

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe(forbidden_paths=["vendor/**"])
    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    assert "NEW_VENDOR_LINE" not in body
    v = next(f for f in meta["files_changed"] if f["path"] == "vendor/lib.py")
    assert v["included_in_diff_body"] is False


def test_secret_hit_blocks_body_and_marks_metadata(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"src/cfg.py": "x = 1\n"})
    _modify(tmp_path, "src/cfg.py",
            "x = 1\nTOKEN = 'ghp_" + "a" * 36 + "'\n")

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()
    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    # The body must NOT contain the secret token characters
    assert "ghp_aaaa" not in body
    # The body should announce it was redacted because of secret detection
    assert "REDACTED" in body.upper() or "BLOCKED" in body.upper()
    # Metadata flags the scan as blocking
    assert meta["secret_scan"]["status"] == "BLOCKED"
    assert any(h["pattern"] == "github_token" for h in meta["secret_scan"]["hits"])


def test_oversized_diff_is_truncated_with_marker(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"src/big.py": "x = 1\n"})
    big = "\n".join(f"line_{i} = {i}" for i in range(5_000)) + "\n"
    _modify(tmp_path, "src/big.py", "x = 1\n" + big)

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe(
        max_total_bytes=4_000, max_per_file_bytes=2_000,
    )
    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    assert "TRUNCATED" in body.upper()
    assert meta["diff_body_truncated"] is True


def test_metadata_has_required_fields(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"src/foo.py": "x = 1\n"})
    _modify(tmp_path, "src/foo.py", "x = 2\n")

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "tsk", "repo_id": "rp"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()
    meta = json.loads(meta_path.read_text())

    for field in (
        "task_id", "repo_id", "files_changed", "diff_body_safe_path",
        "diff_body_truncated", "secret_scan",
    ):
        assert field in meta, f"missing field {field}"
    assert meta["task_id"] == "tsk"
    assert meta["repo_id"] == "rp"
    assert meta["secret_scan"]["status"] in ("PASS", "BLOCKED")
    assert isinstance(meta["files_changed"], list)
    # path field stored relative to workspace
    assert meta["diff_body_safe_path"].endswith("diff_body_safe.md")


def test_no_changes_writes_empty_body(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _commit_initial(tmp_path, {"src/foo.py": "x = 1\n"})

    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t1", "repo_id": "r1"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()
    meta = json.loads(meta_path.read_text())

    assert meta["files_changed"] == []
    assert meta["secret_scan"]["status"] == "PASS"
    assert meta["diff_body_truncated"] is False
