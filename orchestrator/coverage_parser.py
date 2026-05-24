"""Extract a single line-coverage percentage from common report formats.

The runner doesn't impose a coverage tool; this parser is opportunistic
and looks for the most-common artifacts left behind:

  * ``coverage.xml``   — Cobertura / pytest-cov default. Line-rate is an
                         attribute on the root <coverage> element, 0..1.
  * ``coverage.json``  — coverage.py JSON. ``totals.percent_covered``.
  * ``.coverage`` (binary SQLite from coverage.py) is NOT decoded here;
    callers should run ``coverage json -o coverage.json`` first.

Returns ``None`` when no report is present or parseable. Callers fall
back to ``coverage_pct=None`` which keeps the ``low_test_coverage``
factor untriggered.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

_LINE_RATE_RX = re.compile(r'line-rate=["\'](\d*\.?\d+)["\']')


def extract_coverage_pct(workspace: Path) -> float | None:
    workspace = Path(workspace)
    # 1. coverage.xml at any depth (most common)
    for p in sorted(workspace.rglob("coverage.xml"))[:3]:
        pct = _from_cobertura(p)
        if pct is not None:
            return pct
    # 2. coverage.json next to it
    for p in sorted(workspace.rglob("coverage.json"))[:3]:
        pct = _from_coverage_json(p)
        if pct is not None:
            return pct
    return None


def _from_cobertura(path: Path) -> float | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    # Try regex first — Cobertura roots can be huge with namespaces; the
    # line-rate attribute is always on the root element.
    m = _LINE_RATE_RX.search(text[:4000])
    if m:
        try:
            return round(float(m.group(1)) * 100, 2)
        except ValueError:
            pass
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return None
    lr = root.attrib.get("line-rate")
    if lr is None:
        return None
    try:
        return round(float(lr) * 100, 2)
    except ValueError:
        return None


def _from_coverage_json(path: Path) -> float | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    totals = data.get("totals") or {}
    pct = totals.get("percent_covered")
    if pct is None:
        return None
    try:
        return round(float(pct), 2)
    except (TypeError, ValueError):
        return None
