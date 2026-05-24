"""Issue preflight — catch impossible specs BEFORE Coder is dispatched.

V3 issue #15 sat in `coding` forever because the test fixture asked for
`reverse()` tests but `reverse()` didn't exist in `src/utils.py` AND the
issue body also said "Do not modify `src/utils.py`". Coder correctly
identified the impossibility, but the orchestrator had no way to
terminalise the task — it just kept re-dispatching Coder, which kept
returning BLOCKED.

This module parses the issue body for:
  * Python symbols referenced as required (e.g. `reverse(`, `reverse()`)
  * Files claimed to host them (e.g. `src/utils.py`)
  * Whether modifying those files is explicitly forbidden
  * The actual on-disk truth: does the symbol exist in the file?

When all four signals point to "impossible", return a PreflightResult
with `terminal_status="failed"` and the reason. The orchestrator can
then mark the task `failed` and skip Coder entirely.

The detection is deliberately conservative — it ONLY flags the specific
pattern from #15: "symbol X must be tested in file F" + "X absent from F"
+ "modifying F is forbidden". Other failure modes pass through (ok=True)
so that the system keeps its standard recovery path.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class PreflightResult:
    ok: bool
    terminal_status: Optional[str] = None  # "failed" | None
    reason: str = ""
    detected_symbols: list[str] = field(default_factory=list)
    detected_files: list[str] = field(default_factory=list)
    forbidden_files: list[str] = field(default_factory=list)


# Symbols look like word-chars followed by `(` — e.g. `reverse(`, `foo(s)`.
# Test-fixture symbols are usually inside backticks or as bare calls.
_SYMBOL_RE = re.compile(r"`?([a-z_][a-z0-9_]{1,40})`?\s*\(")

# Files look like `src/foo.py` / `tests/bar.py` — relative paths ending .py.
_FILE_RE = re.compile(r"`?([a-z_][a-z0-9_/]{1,60}\.py)`?")

# Phrases that indicate "this file should NOT be modified".
_FORBIDDEN_HINTS_EN = (
    "do not modify",
    "do not edit",
    "do NOT modify",
    "do NOT edit",
    "must not modify",
    "without modifying",
    "no source mod",
    "no modification of",
)
_FORBIDDEN_HINTS_ZH = ("不要修改", "禁止修改", "不修改", "不能修改")
_FORBIDDEN_HINTS = _FORBIDDEN_HINTS_EN + _FORBIDDEN_HINTS_ZH


# Phrases that indicate "this symbol already exists / was added earlier".
# Used to skip preflight when the issue itself acknowledges the symbol
# might not yet exist on the current branch (e.g. "if reverse() exists").
_EXISTS_HINTS_EN = (
    "already exists",
    "previously added",
    "added in earlier",
    "added in an earlier",
    "currently has",
    "should be added",
    "will be added",
    "add a",
    "add the",
)


def _extract_symbols(text: str) -> list[str]:
    """Return symbols referenced as function calls, deduplicated.

    Filter out common false positives (Python keywords, very short names)."""
    seen: list[str] = []
    blacklist = {
        "def", "if", "for", "while", "try", "return", "raise",
        "list", "dict", "tuple", "set", "str", "int", "bool", "float",
        "print", "len", "range", "open", "isinstance",
        # spec/test scaffolding
        "test", "tests", "spec", "specs",
    }
    for m in _SYMBOL_RE.finditer(text):
        sym = m.group(1).lower()
        if sym in blacklist or len(sym) < 3:
            continue
        if sym not in seen:
            seen.append(sym)
    return seen


def _extract_files(text: str) -> list[str]:
    seen: list[str] = []
    for m in _FILE_RE.finditer(text):
        f = m.group(1)
        if f not in seen:
            seen.append(f)
    return seen


def _forbidden_files(text: str) -> list[str]:
    """Return file paths the issue body explicitly forbids modifying."""
    lowered = text.lower()
    forbidden = []
    for hint in _FORBIDDEN_HINTS:
        h = hint.lower() if any(c.isascii() and c.isalpha() for c in hint) else hint
        idx = 0
        while True:
            pos = lowered.find(h, idx)
            if pos < 0:
                break
            # Look 80 chars ahead for a file path
            window = text[pos: pos + 200]
            for m in _FILE_RE.finditer(window):
                f = m.group(1)
                if f not in forbidden:
                    forbidden.append(f)
            idx = pos + len(h)
    return forbidden


def _symbol_present_in_file(symbol: str, file_path: Path) -> bool:
    """True if `def <symbol>(` appears anywhere in the file's text."""
    if not file_path.exists():
        return False
    try:
        text = file_path.read_text(errors="replace")
    except OSError:
        return False
    return bool(re.search(rf"\bdef\s+{re.escape(symbol)}\s*\(", text))


def preflight_issue(title: str, body: str, repo_root: Path) -> PreflightResult:
    """Examine an issue's title+body against the on-disk repo.

    Returns ok=True for everything that doesn't fit the specific
    impossible-spec pattern. Only returns ok=False for the narrow case:
    "symbol X required" + "in file F" + "F forbidden" + "X absent from F".
    """
    text = f"{title}\n{body or ''}"
    symbols = _extract_symbols(text)
    files = _extract_files(text)
    forbidden = _forbidden_files(text)

    # Only run the impossible-spec check when the issue forbids modifying
    # a file AND references at least one source file (not just test files).
    src_forbidden = [f for f in forbidden if f.startswith(("src/", "lib/", "orchestrator/"))]
    if not src_forbidden:
        return PreflightResult(
            ok=True,
            detected_symbols=symbols,
            detected_files=files,
            forbidden_files=forbidden,
        )

    # For each symbol that the issue requires, check whether it exists in
    # any of the forbidden source files. If a symbol is referenced AND its
    # target file is forbidden from modification AND the symbol isn't on disk,
    # the task is impossible.
    impossible_symbols: list[str] = []
    target_files: list[str] = []
    for sym in symbols:
        for forbidden_file in src_forbidden:
            fp = repo_root / forbidden_file
            if not _symbol_present_in_file(sym, fp):
                impossible_symbols.append(sym)
                target_files.append(forbidden_file)
                break

    if impossible_symbols:
        reason = (
            f"blocked_impossible_spec: required symbol(s) "
            f"{', '.join(impossible_symbols)} missing from forbidden-to-modify "
            f"file(s) {', '.join(target_files)}; the issue cannot be completed "
            f"under its own constraints."
        )
        return PreflightResult(
            ok=False,
            terminal_status="failed",
            reason=reason,
            detected_symbols=symbols,
            detected_files=files,
            forbidden_files=forbidden,
        )

    return PreflightResult(
        ok=True,
        detected_symbols=symbols,
        detected_files=files,
        forbidden_files=forbidden,
    )
