from __future__ import annotations

import json
from pathlib import Path

from runner.evidence_collector import EvidenceCollector


def test_writes_contract_with_goal(tmp_path: Path) -> None:
    spec = {
        "task_id": "t1", "repo_id": "r1", "goal": "do the thing",
        "allowed_paths": ["src/**"], "forbidden_paths": [".env"],
    }
    ec = EvidenceCollector(workspace=tmp_path, task_spec=spec)
    p = ec.write_contract()
    body = p.read_text()
    assert "do the thing" in body
    assert "src/**" in body


def test_run_named_commands_captures_exit_and_output(tmp_path: Path) -> None:
    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t"})
    results = ec.run_named_commands("test", ["echo hello && exit 0", "false"])
    assert len(results) == 2
    assert results[0]["exit"] == 0
    assert "hello" in results[0]["stdout_tail"]
    assert results[1]["exit"] != 0
    # results json on disk matches
    on_disk = json.loads((tmp_path / ".evidence" / "test_results.json").read_text())
    assert on_disk == results


def test_snapshot_manifest_skips_evidence_and_git(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x = 1\n")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]\n")
    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t"})
    ec.snapshot_manifest()
    manifest = json.loads((tmp_path / ".evidence" / "file_manifest.json").read_text())
    assert "src/a.py" in manifest
    assert not any(".git" in m for m in manifest)


def test_worker_done_payload_round_trips(tmp_path: Path) -> None:
    ec = EvidenceCollector(workspace=tmp_path, task_spec={"task_id": "t"})
    ec.write_worker_done({"ok": True, "extra": 42})
    body = (tmp_path / ".evidence" / "worker_done.md").read_text()
    assert '"ok": true' in body
    assert '"extra": 42' in body
