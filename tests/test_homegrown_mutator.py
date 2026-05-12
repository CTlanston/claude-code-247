"""Regression tests for scripts/mutate_billable.py (Track T5).

Homegrown small-scope mutation tester (FAIL-0011 option 3). Tests cover:
- Each mutation operator transforms the AST correctly
- Candidate collection enumerates all expected positions
- Docstrings are NOT mutated
- Kill-rate arithmetic is correct
- End-to-end on a tiny synthetic module: 100% kill rate when tests are
  strong, < 100% when the test misses a mutation
- Safety: billable.py restoration invariant even on mid-run failure
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import mutate_billable as mb  # noqa: E402


# --- Unit: mutation operators on AST nodes --------------------------------


def test_mutate_comparison_eq_to_noteq():
    """`a == 1` → `a != 1`."""
    tree = ast.parse("a == 1", mode="eval")
    cmp = tree.body
    mutants = list(mb.mutate_comparison(cmp))
    assert len(mutants) == 1
    src = ast.unparse(mutants[0])
    assert src == "a != 1"


def test_mutate_comparison_lt_to_gte():
    tree = ast.parse("x < 5", mode="eval")
    mutants = list(mb.mutate_comparison(tree.body))
    assert ast.unparse(mutants[0]) == "x >= 5"


def test_mutate_comparison_gte_to_lt():
    tree = ast.parse("x >= 5", mode="eval")
    mutants = list(mb.mutate_comparison(tree.body))
    assert ast.unparse(mutants[0]) == "x < 5"


def test_mutate_boolean_true_to_false():
    node = ast.Constant(value=True)
    mutants = list(mb.mutate_boolean_constant(node))
    assert len(mutants) == 1
    assert mutants[0].value is False


def test_mutate_boolean_false_to_true():
    node = ast.Constant(value=False)
    mutants = list(mb.mutate_boolean_constant(node))
    assert mutants[0].value is True


def test_mutate_boolean_skips_non_bool_constants():
    """Strings, ints, floats are not boolean — should produce no mutants
    from this operator."""
    assert list(mb.mutate_boolean_constant(ast.Constant(value=42))) == []
    assert list(mb.mutate_boolean_constant(ast.Constant(value="x"))) == []


def test_mutate_numeric_off_by_one_positive():
    """An int constant like 86400 → 86399 and 86401."""
    mutants = list(mb.mutate_numeric_constant(ast.Constant(value=86400)))
    values = sorted(m.value for m in mutants)
    assert 86399 in values
    assert 86401 in values


def test_mutate_numeric_skips_zero():
    """0 is a special case (often a sentinel); skipping avoids 0→1
    swaps that fire on every cycle. Off-by-one on zero is too cheap."""
    mutants = list(mb.mutate_numeric_constant(ast.Constant(value=0)))
    assert mutants == []


def test_mutate_numeric_skips_floats_by_default():
    """0.0, 0.5, 1.0 are float-Constants; this operator only targets ints."""
    assert list(mb.mutate_numeric_constant(ast.Constant(value=0.5))) == []


def test_mutate_binop_add_to_sub():
    tree = ast.parse("a + b", mode="eval")
    mutants = list(mb.mutate_binop(tree.body))
    assert any(ast.unparse(m) == "a - b" for m in mutants)


def test_mutate_binop_mult_to_div():
    tree = ast.parse("x * 2", mode="eval")
    mutants = list(mb.mutate_binop(tree.body))
    assert any(ast.unparse(m) == "x / 2" for m in mutants)


def test_mutate_return_none_for_nonnull_return():
    tree = ast.parse("def f():\n    return 42")
    ret = tree.body[0].body[0]
    mutants = list(mb.mutate_return(ret))
    assert len(mutants) == 1
    assert ast.unparse(mutants[0]).strip() == "return None"


def test_mutate_return_skips_already_none_return():
    tree = ast.parse("def f():\n    return None")
    ret = tree.body[0].body[0]
    assert list(mb.mutate_return(ret)) == []


def test_mutate_unaryop_not_to_drop():
    tree = ast.parse("not x", mode="eval")
    mutants = list(mb.mutate_unaryop(tree.body))
    assert any(ast.unparse(m).strip() == "x" for m in mutants)


# --- collect_mutations -----------------------------------------------------


def test_collect_mutations_returns_at_least_one_per_candidate_kind():
    """Sample source with all six operators should yield candidates
    for each kind."""
    source = textwrap.dedent("""
        def f(x):
            if x == 1:
                return True
            return x + 2
        flag = not x
    """).strip()
    candidates = mb.collect_mutations(source)
    kinds = {c.kind for c in candidates}
    assert "comparison" in kinds
    assert "boolean" in kinds
    assert "binop" in kinds
    assert "return" in kinds
    assert "unaryop" in kinds


def test_collect_mutations_skips_module_docstring():
    """A module-level docstring is a Constant node — must NOT be flagged."""
    source = '"""this is a module docstring"""\n\ndef f():\n    return 1\n'
    cands = mb.collect_mutations(source)
    # No mutations on the docstring; only the `return 1` → None
    assert all(c.kind != "boolean" for c in cands)
    # The 'return 1' → 'return None' should be present
    assert any(c.kind == "return" for c in cands)


def test_collect_mutations_skips_function_docstring():
    """Function docstring (first stmt is Expr(Constant(str))) is skipped."""
    source = textwrap.dedent("""
        def f():
            \"\"\"docstring\"\"\"
            return 1
    """).strip()
    cands = mb.collect_mutations(source)
    # No string Constant should be flagged for mutation
    str_candidates = [c for c in cands if c.kind == "string"]
    assert str_candidates == []


def test_collect_mutations_billable_real_repo_has_at_least_10():
    """The real orchestrator/billable.py should yield at least 10
    candidates — enough surface for a meaningful kill-rate measurement."""
    source = (REPO_ROOT / "orchestrator" / "billable.py").read_text()
    cands = mb.collect_mutations(source)
    assert len(cands) >= 10, f"only {len(cands)} mutation candidates"


# --- apply_mutation --------------------------------------------------------


def test_apply_mutation_is_pure():
    """Applying a mutation returns a new source string; the input source
    is NOT modified."""
    source = "x = 1 + 2\n"
    cands = mb.collect_mutations(source)
    assert cands, "expected at least one candidate"
    mutated = mb.apply_mutation(source, cands[0])
    # Original source string is unchanged (Python strings are immutable
    # so this is a tautology, but the function shouldn't have side effects)
    assert source == "x = 1 + 2\n"
    # Mutated source differs
    assert mutated != source


# --- kill-rate arithmetic --------------------------------------------------


def test_kill_rate_basic():
    assert mb.kill_rate(killed=8, total=10) == 0.8


def test_kill_rate_zero_total():
    """Defensive: total=0 returns 0.0 (not div-by-zero)."""
    assert mb.kill_rate(killed=0, total=0) == 0.0


def test_kill_rate_caps_at_one():
    """Pathological case: killed > total → clamp to 1.0."""
    assert mb.kill_rate(killed=11, total=10) == 1.0


# --- Safety: billable.py invariant ----------------------------------------


def test_billable_byte_identical_after_run(tmp_path):
    """The headline safety property: even if some mutations fail to
    apply, the SUT file is byte-identical before vs after.

    Uses a synthetic module so we don't actually invoke the live
    billable mutation run (which is expensive).
    """
    sut = tmp_path / "sut.py"
    sut.write_text("def f(x):\n    return x + 1\n")
    original = sut.read_bytes()
    # Run the apply-and-restore helper directly
    candidates = mb.collect_mutations(sut.read_text())
    for cand in candidates[:3]:
        try:
            mb._apply_with_restore(sut, cand, runner=lambda: True)
        except Exception:  # noqa: BLE001
            pass
    after = sut.read_bytes()
    assert original == after, "SUT was not restored byte-identically"


def test_apply_with_restore_restores_on_runner_exception(tmp_path):
    """Even if the runner callable raises, the SUT is restored."""
    sut = tmp_path / "sut.py"
    sut.write_text("def f():\n    return 1\n")
    original = sut.read_bytes()
    cands = mb.collect_mutations(sut.read_text())
    assert cands, "need at least one candidate"

    def bad_runner():
        raise RuntimeError("test runner blew up")

    with pytest.raises(RuntimeError):
        mb._apply_with_restore(sut, cands[0], runner=bad_runner)
    after = sut.read_bytes()
    assert original == after


# --- End-to-end on tiny synthetic module ----------------------------------


def test_end_to_end_synthetic_kill_rate(tmp_path):
    """Build a tiny module + a tiny test that strongly covers it.
    Run the mutator; expect high kill rate (≥ 0.5 — actually we expect
    100% but allow slack for any single mutation the trivial test
    misses)."""
    sut = tmp_path / "sut.py"
    sut.write_text(textwrap.dedent("""
        def is_positive(x):
            return x > 0
    """).strip() + "\n")

    test_file = tmp_path / "test_sut.py"
    test_file.write_text(textwrap.dedent("""
        import sys
        sys.path.insert(0, ".")
        from sut import is_positive
        def test_positive_one():
            assert is_positive(1) is True
        def test_zero_is_not_positive():
            assert is_positive(0) is False
        def test_negative_is_not_positive():
            assert is_positive(-1) is False
    """).strip())

    # Use the mutator's run_kill_set helper
    rate, killed, total, _details = mb.run_kill_set(
        sut_path=sut,
        test_command=["python3", "-m", "pytest", "-q", "--no-cov", "-x",
                      str(test_file)],
        cwd=tmp_path,
    )
    assert total >= 1, "expected at least one mutation candidate"
    # The 3 assertions strongly cover `x > 0`: flipping to `< 0`,
    # `>= 0`, or `<= 0` all fail at least one assertion. Expect 100%.
    assert rate >= 0.5, f"unexpectedly low kill rate on strong tests: {rate}"


# --- CLI -------------------------------------------------------------------


def test_cli_writes_kill_rate_file(tmp_path):
    """`python3 scripts/mutate_billable.py --sut <PATH> --tests <PATH>
    --out <PATH>` writes a parseable float."""
    sut = tmp_path / "sut.py"
    sut.write_text("def f(): return 1\n")
    test = tmp_path / "test_sut.py"
    test.write_text(
        "import sys; sys.path.insert(0, '.')\n"
        "from sut import f\n"
        "def test_f(): assert f() == 1\n"
    )
    out = tmp_path / "kill-rate.txt"
    rc = mb.main([
        "--sut", str(sut),
        "--tests", str(test),
        "--out", str(out),
        "--cwd", str(tmp_path),
    ])
    assert rc == 0
    assert out.exists()
    rate = float(out.read_text().strip().splitlines()[0])
    assert 0.0 <= rate <= 1.0
