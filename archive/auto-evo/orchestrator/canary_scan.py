"""Canary-token leakage scan (Track S6, S-L7 safety gate, Cycle 36).

Operators plant canary tokens of the well-known shape
`AUTODEV_CANARY_<HEX>` (>= 8 hex chars after the prefix) in
environments, inputs, or test data. This module scans text and
files for those tokens so the system can detect if they ever leak
to a log, audit trail, or output it might write back.

The pattern is deliberately narrow:
- Exact uppercase `AUTODEV_CANARY_` prefix (no lowercase / mixed)
- Followed by >= 8 chars of uppercase hex digits [A-F0-9]

That narrowness means scans don't false-positive on git SHAs,
base64 blobs, or other high-entropy strings — only on values
that match the deliberate canary shape an operator planted.

Public surface:
- `CANARY_PATTERN`: compiled regex
- `scan_text(text)`: list of canaries found, dedup-by-first-seen
- `scan_file(path)`: list of (line_number, canary) tuples
- `scan_paths(paths)`: list of (path, line_number, canary) tuples
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, List, Tuple


# Deliberate narrow pattern. Operators using `AUTODEV_CANARY_` as
# the prefix opt into being scanned for; nothing else triggers.
CANARY_PATTERN: re.Pattern = re.compile(r"AUTODEV_CANARY_[A-F0-9]{8,}")


def scan_text(text: str) -> List[str]:
    """Return all distinct canary tokens found in `text`, in order
    of first appearance. Dedup is by exact-string equality.
    """
    seen: dict = {}  # ordered dict semantics in py3.7+; preserves first-seen
    for m in CANARY_PATTERN.finditer(text):
        token = m.group(0)
        if token not in seen:
            seen[token] = True
    return list(seen.keys())


def scan_file(path: Path) -> List[Tuple[int, str]]:
    """Walk `path` line-by-line and return (line_number, canary)
    matches. NEVER raises:
      - missing file → []
      - binary / un-decodable file → []
      - any other OSError → []
    """
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError, PermissionError,
            UnicodeDecodeError, OSError):
        return []
    out: List[Tuple[int, str]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for m in CANARY_PATTERN.finditer(line):
            out.append((lineno, m.group(0)))
    return out


def scan_paths(paths: Iterable[Path]) -> List[Tuple[Path, int, str]]:
    """Apply `scan_file` to each path in `paths` and flatten the
    results to `(path, line_number, canary)` tuples. Missing or
    binary files are silently skipped (matching `scan_file`'s
    never-raise contract)."""
    out: List[Tuple[Path, int, str]] = []
    for p in paths:
        pp = Path(p)
        for (lineno, tok) in scan_file(pp):
            out.append((pp, lineno, tok))
    return out
