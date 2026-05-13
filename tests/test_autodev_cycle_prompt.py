"""Structural tests for scripts/autodev_cycle_prompt.md (Cycle 26).

This prompt file is the standing instruction that
`scripts/autodev_continuous_cycle.sh` feeds to `claude -p` on every
launchd wake. It MUST stay self-contained, headless, and honor the
L7 §0 / §13 / §16 constraints. These tests pin the required sections
so a future edit can't silently break headless mode.

The tests intentionally check text content (not behavior) — the prompt
file is read by a language model, not executed. Structural drift is
the failure mode we're guarding against.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
PROMPT = REPO_ROOT / "scripts" / "autodev_cycle_prompt.md"


def _text() -> str:
    return PROMPT.read_text(encoding="utf-8")


# --- Existence & basic shape -------------------------------------------


def test_prompt_file_exists():
    assert PROMPT.exists(), (
        f"{PROMPT} must exist — the launchd wake script reads it on "
        f"every cycle"
    )


def test_prompt_file_nontrivial_size():
    """Guard against accidental truncation: must be > 1500 chars."""
    assert len(_text()) > 1500, (
        "prompt file is suspiciously short; a real wake-cycle prompt "
        "with ORIENT/DECISIONS/ACT/CONSTRAINTS/C-DIM/OUTPUT needs "
        "more than 1500 chars"
    )


# --- Required sections (the 6 canonical headings) ----------------------


def test_has_orient_section():
    assert re.search(r"##\s+ORIENT", _text(), re.IGNORECASE), (
        "missing ## ORIENT section"
    )


def test_has_decisions_section():
    assert re.search(r"##\s+DECISIONS", _text(), re.IGNORECASE), (
        "missing ## DECISIONS section"
    )


def test_has_act_section():
    assert re.search(r"##\s+ACT", _text(), re.IGNORECASE), (
        "missing ## ACT section"
    )


def test_has_constraints_section():
    assert re.search(r"##\s+CONSTRAINTS", _text(), re.IGNORECASE), (
        "missing ## CONSTRAINTS section"
    )


def test_has_c_dim_handling_section():
    assert re.search(r"##\s+C[- ]DIM", _text(), re.IGNORECASE), (
        "missing ## C-DIM SPECIAL HANDLING section (the C streak "
        "accumulator)"
    )


def test_has_output_section():
    assert re.search(r"##\s+OUTPUT", _text(), re.IGNORECASE), (
        "missing ## OUTPUT contract section"
    )


# --- L7 master-prompt references ---------------------------------------


def test_references_section_zero_hard_constraints():
    txt = _text()
    # Accept either "§0" or "section 0" or "§0 hard constraints"
    assert re.search(r"§0|section\s+0\b", txt, re.IGNORECASE), (
        "prompt must reference §0 hard constraints from "
        "AUTODEV_L7_MASTER_PROMPT.md"
    )


def test_references_section_thirteen_termination():
    txt = _text()
    assert re.search(r"§13|section\s+13\b", txt, re.IGNORECASE), (
        "prompt must reference §13 termination checklist"
    )


def test_references_section_sixteen_tone():
    txt = _text()
    assert re.search(r"§16|section\s+16\b", txt, re.IGNORECASE), (
        "prompt must reference §16 tone & discipline"
    )


def test_mentions_45_minute_budget():
    txt = _text()
    assert re.search(r"45[\s\-]?min", txt, re.IGNORECASE), (
        "prompt must mention the 45-min wall-clock budget"
    )


def test_mentions_adr_0008_codex_budget_guard():
    txt = _text()
    assert "0008" in txt or re.search(
        r"codex.{0,20}budget.{0,10}guard", txt, re.IGNORECASE
    ), "prompt must reference ADR-0008 codex budget guard"


# --- Headless mode markers (no interactive language) -------------------


def test_no_interactive_ask_human_language():
    """The prompt must NOT contain language that suggests asking the
    operator. Headless mode = no human is reading stdout."""
    txt = _text()
    # Negative patterns — these phrases must NOT appear as imperatives
    forbidden = [
        r"\bask the (human|operator|user)\b",
        r"wait for confirmation",
        r"what would you like (me )?to do",
        r"please confirm",
        r"do you want me to",
    ]
    # We allow descriptive mentions ("DO NOT ask the human") because the
    # prompt itself instructs the model NOT to ask — that's headless
    # discipline, not interactive language. Filter out those negations.
    for pattern in forbidden:
        matches = re.finditer(pattern, txt, re.IGNORECASE)
        for m in matches:
            # Find the line containing this match
            line_start = txt.rfind("\n", 0, m.start()) + 1
            line_end = txt.find("\n", m.end())
            if line_end == -1:
                line_end = len(txt)
            line = txt[line_start:line_end].lower()
            # Skip if it's clearly a negation ("DO NOT ask", "NEVER ask",
            # "no asking", "do not ask")
            if any(neg in line for neg in [
                "do not", "don't", "never", "no asking",
                "no clarifying", "no interactive",
            ]):
                continue
            raise AssertionError(
                f"forbidden interactive phrase {pattern!r} found in a "
                f"non-negated context: {line.strip()!r}"
            )


def test_explicitly_forbids_clarifying_questions():
    """The prompt must explicitly tell the model NOT to ask
    clarifying questions, per §0 rule 10."""
    txt = _text()
    # Look for an explicit headless instruction
    assert re.search(
        r"no\s+(clarifying|interactive)\s+(question|prompt)",
        txt, re.IGNORECASE
    ) or re.search(
        r"(never|do not|don't|no)\s+ask\b",
        txt, re.IGNORECASE
    ), (
        "prompt must explicitly forbid clarifying questions / asking "
        "the human (headless one-shot discipline)"
    )


def test_mentions_one_cycle_per_wake():
    """Headless one-shot: ONE cycle per launchd wake."""
    txt = _text()
    assert re.search(
        r"(one|ONE|single)[- ]?(shot|cycle|wake)",
        txt
    ), (
        "prompt must specify ONE cycle per wake (no multi-cycle "
        "ambition)"
    )


# --- Procedural lesson from Cycle 25 (RECORD step ordering) ------------


def test_encodes_propose_before_compute_check_ordering():
    """Cycle 25 surfaced a procedural lesson: run
    `propose_next_track --for-cycle <id>` BEFORE
    `compute_level.py --check` during RECORD, else the last-5-cycles
    E-dim window transiently shows 4/5 and E false-regresses 7→4.
    The prompt must encode this so launchd-driven wakes don't repeat
    the false alarm."""
    txt = _text()
    # Must mention both commands AND the ordering
    has_propose = "propose_next_track" in txt
    has_check = re.search(r"compute_level\.py\s+--check", txt) is not None
    assert has_propose and has_check, (
        "prompt must reference BOTH propose_next_track and "
        "compute_level --check"
    )
    # Must say "before" or "first" or "BEFORE" near the propose call.
    # Accept both `propose_next_track --for-cycle` and the
    # `propose_next_track.py --for-cycle` script-invocation form.
    m = re.search(r"propose_next_track(?:\.py)?\s+--for-cycle", txt)
    assert m is not None, (
        "prompt must use the `--for-cycle <id>` form of "
        "propose_next_track during RECORD"
    )
    propose_idx = m.start()
    # Scan a 600-char window around the propose call for the ordering hint
    window = txt[max(0, propose_idx - 300): propose_idx + 600]
    assert re.search(r"\bBEFORE\b|\bfirst\b", window), (
        "prompt must explicitly state that propose_next_track runs "
        "BEFORE compute_level --check"
    )


# --- §4 cycle protocol steps -------------------------------------------


def test_mentions_pytest():
    assert "pytest" in _text(), "VERIFY step must run pytest"


def test_mentions_rollback_tag():
    """§4 step 2: tag `autoevo/pre-<cycle-id>` is mandatory."""
    txt = _text()
    assert "autoevo/pre-" in txt, (
        "prompt must mention the autoevo/pre-<cycle-id> rollback tag"
    )


def test_mentions_failures_md_preflight():
    """§4 step 6: preflight against FAILURES.md is mandatory."""
    txt = _text()
    assert "FAILURES.md" in txt, (
        "prompt must reference FAILURES.md for preflight"
    )
    assert "preflight" in txt.lower(), (
        "prompt must mention the preflight step explicitly"
    )


def test_mentions_atomic_commit():
    """§4 step 9: one cycle = one atomic commit."""
    txt = _text()
    assert re.search(r"atomic\s+commit", txt, re.IGNORECASE), (
        "prompt must require atomic commits"
    )


def test_mentions_c_streak_target():
    """C-L5 requires the 30-cycle streak."""
    txt = _text()
    assert "30" in txt and re.search(r"streak", txt, re.IGNORECASE), (
        "prompt must mention the 30-cycle zero-deadlock streak target "
        "for C-L5"
    )


def test_mentions_target_l_env_var():
    """Termination is governed by AUTODEV_TARGET_L."""
    txt = _text()
    assert "AUTODEV_TARGET_L" in txt, (
        "prompt must reference the AUTODEV_TARGET_L env var "
        "(default 5) for termination"
    )


def test_mentions_autodev_done_marker():
    """Termination writes reports/AUTODEV_DONE.md."""
    txt = _text()
    assert "AUTODEV_DONE.md" in txt, (
        "prompt must mention reports/AUTODEV_DONE.md as the "
        "completion marker"
    )


def test_mentions_stopswitch():
    txt = _text()
    assert "STOPSWITCH" in txt, (
        "prompt must mention reports/STOPSWITCH as the human-halt "
        "marker"
    )


def test_mentions_blocked_md():
    txt = _text()
    assert "BLOCKED.md" in txt, (
        "prompt must mention BLOCKED.md handling"
    )


# --- Forbidden things --------------------------------------------------


def test_no_git_push_instruction():
    """Per §0 rule 2: NEVER git push."""
    txt = _text()
    # Look for any actual instruction to push. Allow "No `git push`."
    # negations.
    for match in re.finditer(r"git\s+push", txt, re.IGNORECASE):
        line_start = txt.rfind("\n", 0, match.start()) + 1
        line_end = txt.find("\n", match.end())
        if line_end == -1:
            line_end = len(txt)
        line = txt[line_start:line_end].lower()
        # Allow negation context only
        assert any(
            neg in line for neg in [
                "no ", "never", "do not", "don't",
            ]
        ), (
            f"prompt mentions `git push` in a non-negated context: "
            f"{line.strip()!r}"
        )
