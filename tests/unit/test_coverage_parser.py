from __future__ import annotations

import json
from pathlib import Path

from orchestrator.coverage_parser import extract_coverage_pct


def test_returns_none_when_no_report(tmp_path: Path) -> None:
    assert extract_coverage_pct(tmp_path) is None


def test_parses_cobertura_xml(tmp_path: Path) -> None:
    (tmp_path / "coverage.xml").write_text(
        '<?xml version="1.0"?>\n'
        '<coverage line-rate="0.875" branch-rate="0.0" timestamp="0">\n'
        '  <packages/>\n'
        '</coverage>\n'
    )
    assert extract_coverage_pct(tmp_path) == 87.5


def test_parses_coverage_json(tmp_path: Path) -> None:
    (tmp_path / "coverage.json").write_text(json.dumps({
        "totals": {"percent_covered": 73.2}
    }))
    assert extract_coverage_pct(tmp_path) == 73.2


def test_prefers_xml_when_both_present(tmp_path: Path) -> None:
    (tmp_path / "coverage.xml").write_text(
        '<coverage line-rate="0.42"/>'
    )
    (tmp_path / "coverage.json").write_text(json.dumps({
        "totals": {"percent_covered": 99}
    }))
    assert extract_coverage_pct(tmp_path) == 42.0


def test_finds_xml_in_subdir(tmp_path: Path) -> None:
    sub = tmp_path / "build" / "reports"
    sub.mkdir(parents=True)
    (sub / "coverage.xml").write_text('<coverage line-rate="0.5"/>')
    assert extract_coverage_pct(tmp_path) == 50.0


def test_handles_invalid_xml_gracefully(tmp_path: Path) -> None:
    (tmp_path / "coverage.xml").write_text("not even close to xml")
    # No regex match either since "line-rate=..." isn't in the body.
    assert extract_coverage_pct(tmp_path) is None
