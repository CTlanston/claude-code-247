"""Structural tests for .claude/skills/matt.*.md (Cycle 32, Track K1).

Wave 1 Skill stubs. Future Track K2 wires these into
orchestrator/skill_router.py. These tests pin existence + the
required sections so a future edit can't silently drop one.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / ".claude" / "skills"

SKILLS = [
    "matt.diagnose",
    "matt.tdd",
    "matt.to-issues",
    "matt.improve-codebase-architecture",
    "matt.grill-with-docs",
]


def _path(slug: str) -> Path:
    return SKILLS_DIR / f"{slug}.md"


def _text(slug: str) -> str:
    return _path(slug).read_text(encoding="utf-8")


# --- Existence + size ---------------------------------------------------


def test_skills_directory_exists():
    assert SKILLS_DIR.exists() and SKILLS_DIR.is_dir()


def test_each_skill_file_exists():
    """All 5 Wave 1 skill files must be present."""
    missing = [slug for slug in SKILLS if not _path(slug).exists()]
    assert not missing, f"missing Wave 1 skills: {missing}"


def test_each_skill_file_nontrivial_size():
    """Each Skill.md must be > 800 bytes (purpose + when + what +
    NOT + exit criteria + related is a lot of content for a stub)."""
    for slug in SKILLS:
        size = len(_text(slug))
        assert size > 800, (
            f"{slug}.md is only {size} bytes; likely truncated"
        )


# --- Required headings (per skill template) ----------------------------


def test_each_skill_has_purpose_section():
    for slug in SKILLS:
        assert re.search(r"##\s+Purpose", _text(slug)), (
            f"{slug}.md missing ## Purpose"
        )


def test_each_skill_has_when_to_invoke_section():
    for slug in SKILLS:
        assert re.search(r"##\s+When to invoke", _text(slug)), (
            f"{slug}.md missing ## When to invoke"
        )


def test_each_skill_has_what_does_section():
    for slug in SKILLS:
        assert re.search(r"##\s+What this skill does\b", _text(slug)), (
            f"{slug}.md missing ## What this skill does"
        )


def test_each_skill_has_what_does_NOT_section():
    for slug in SKILLS:
        assert re.search(
            r"##\s+What this skill does NOT do", _text(slug)
        ), f"{slug}.md missing ## What this skill does NOT do"


def test_each_skill_has_exit_criteria_section():
    for slug in SKILLS:
        assert re.search(r"##\s+Exit criteria", _text(slug)), (
            f"{slug}.md missing ## Exit criteria"
        )


def test_each_skill_has_related_artifacts_section():
    for slug in SKILLS:
        assert re.search(r"##\s+Related artifacts", _text(slug)), (
            f"{slug}.md missing ## Related artifacts"
        )


# --- Wave 1 stub marker --------------------------------------------------


def test_each_skill_marked_as_wave_1_stub():
    """Each file should declare its Wave 1 status so future K2
    work can find them programmatically."""
    for slug in SKILLS:
        txt = _text(slug)
        assert "Wave 1" in txt, (
            f"{slug}.md must declare 'Wave 1' status"
        )
        assert "skill_router" in txt or "Track K2" in txt, (
            f"{slug}.md must reference the future skill_router/K2 wire-up"
        )


# --- Per-skill content guards (catch swapped-headings drift) ----------


def test_diagnose_mentions_reproduce_minimize_hypothesize():
    """The diagnose skill specifically must mention the 4-step
    Diagnose flow from §7."""
    txt = _text("matt.diagnose")
    assert "Reproduce" in txt or "reproduce" in txt
    assert "Minimize" in txt or "minimize" in txt
    assert "Hypothesize" in txt or "hypothesize" in txt


def test_tdd_mentions_test_first():
    """The TDD skill must articulate the test-first principle."""
    txt = _text("matt.tdd")
    assert re.search(r"test\s+first|test-first|red.*green", txt, re.IGNORECASE)


def test_tdd_cites_fail_0001():
    """The TDD skill should cite FAIL-0001 (the trailing-test
    edge case that drove the intent-detection fix)."""
    txt = _text("matt.tdd")
    assert "FAIL-0001" in txt


def test_to_issues_mentions_acceptance_criteria():
    txt = _text("matt.to-issues")
    assert "Acceptance criteria" in txt or "acceptance criteria" in txt


def test_to_issues_does_not_auto_post():
    """The to-issues skill MUST NOT post issues; that's an operator
    action."""
    txt = _text("matt.to-issues")
    assert re.search(
        r"does NOT post|not auto.{0,5}post|operator", txt, re.IGNORECASE
    )


def test_architecture_skill_mentions_adr():
    """An architecture skill that doesn't drive ADR creation is
    incomplete."""
    txt = _text("matt.improve-codebase-architecture")
    assert "ADR" in txt or "adr" in txt


def test_grill_with_docs_mentions_contract():
    txt = _text("matt.grill-with-docs")
    assert "contract" in txt.lower()


# --- No "ask the human" interactive language ---------------------------


def test_no_interactive_ask_in_diagnose_or_tdd():
    """Diagnose and TDD skills run inside autonomous cycles; they
    must not ask the human for input mid-flow."""
    for slug in ["matt.diagnose", "matt.tdd"]:
        txt = _text(slug)
        # The to-issues skill explicitly DOES escalate to humans for
        # issue posting; that's fine. But diagnose/tdd must not.
        for pattern in [
            r"\bask the (human|user|operator)\b",
            r"wait for confirmation",
            r"please confirm",
        ]:
            for m in re.finditer(pattern, txt, re.IGNORECASE):
                line_start = txt.rfind("\n", 0, m.start()) + 1
                line_end = txt.find("\n", m.end())
                if line_end == -1:
                    line_end = len(txt)
                line = txt[line_start:line_end].lower()
                # Skip if negated
                if any(
                    neg in line for neg in [
                        "do not", "don't", "never", "no asking",
                        "no interactive",
                    ]
                ):
                    continue
                raise AssertionError(
                    f"{slug}.md has interactive phrase {pattern!r} "
                    f"in non-negated context: {line.strip()!r}"
                )
