#!/usr/bin/env python3
"""mutate_billable.py — homegrown small-scope mutation tester.

Track T5 / FAIL-0011 option 3. mutmut 3.x couldn't handle our cross-
module imports (FAIL-0011); this is a ~250-line standalone alternative
targeting `orchestrator/billable.py` (94 lines, 3 functions) with the
existing V4 + property test suite as the kill set.

Algorithm:
  1. Parse SUT file with `ast`
  2. Walk AST; for each candidate node, emit a Mutation record
  3. For each mutation:
     a. Backup SUT file content (bytes) in memory
     b. Apply mutation via `ast.unparse` of mutated tree
     c. Write mutant to SUT path on disk
     d. Run the test command
     e. (try/finally) restore original bytes EXACTLY
     f. Record: test_exit_nonzero → killed; test_exit_zero → survived
  4. Compute kill rate; write to `reports/mutmut-kill-rate.txt`

The mutator NEVER leaves the SUT in a mutated state on disk — the
backup-restore is atomic at the Python-call level and runs in
try/finally. The `_apply_with_restore` helper is the safety chokepoint.

Mutation operators (6):
  comparison: == ↔ !=, < ↔ >=, > ↔ <=
  boolean:    True ↔ False
  numeric:    int N (N != 0) → N±1
  binop:      Add ↔ Sub, Mult ↔ Div
  return:     `return <expr>` → `return None`  (if expr != None)
  unaryop:    `not x` → `x`  (drop the negation)

Docstrings are NOT mutated. Module-level / function-level / class-level
strings that occupy the first statement (the docstring slot) are
skipped during candidate collection.

Usage:
  scripts/mutate_billable.py
  scripts/mutate_billable.py --sut PATH --tests PATH --out PATH
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import os
import re
import subprocess
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SUT = REPO_ROOT / "orchestrator" / "billable.py"
# Default kill set: V4 deterministic + the new test_billable_mutation_anchors.py
# (Cycle 18 Track T5). The anchors surgically target the V4 survivors with
# deterministic test cases, lifting the kill rate above 80% with NO Hypothesis
# dependency (property tests are randomized → non-deterministic kill rate).
DEFAULT_TESTS = [
    REPO_ROOT / "tests" / "test_v4_hardening.py",
    REPO_ROOT / "tests" / "test_billable_mutation_anchors.py",
]
DEFAULT_OUT = REPO_ROOT / "reports" / "mutmut-kill-rate.txt"
DEFAULT_REPORT = REPO_ROOT / "reports" / "mutation-report.md"
DEFAULT_TIMEOUT_S = 30  # per-mutant test timeout


@dataclass
class Mutation:
    kind: str                # comparison|boolean|numeric|binop|return|unaryop
    node_id: int             # id() of the original node (for replacement targeting)
    location: str            # human-readable file:line description
    original_repr: str
    mutant_repr: str
    parent_index: int = -1   # index of the candidate (for ordering / display)


@dataclass
class MutationResult:
    mutation: Mutation
    killed: bool
    test_exit: int = 0
    notes: str = ""


# --- AST mutation operators -----------------------------------------------


_CMP_FLIP = {
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.Lt: ast.GtE,
    ast.LtE: ast.Gt,
    ast.Gt: ast.LtE,
    ast.GtE: ast.Lt,
}

_BINOP_SWAP = {
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.Div,
    ast.Div: ast.Mult,
}


def mutate_comparison(node: ast.Compare) -> Iterable[ast.AST]:
    """Yield one mutated Compare per comparator that can be flipped."""
    for i, op in enumerate(node.ops):
        flipped = _CMP_FLIP.get(type(op))
        if flipped is None:
            continue
        new = copy.deepcopy(node)
        new.ops[i] = flipped()
        yield new


def mutate_boolean_constant(node: ast.Constant) -> Iterable[ast.AST]:
    """Yield True↔False mutant for boolean constants only.

    Python's `1 == True` means int 1 is isinstance(int). We test on
    `isinstance(v, bool)` to only target real booleans."""
    if not isinstance(node.value, bool):
        return
    yield ast.Constant(value=not node.value)


def mutate_numeric_constant(node: ast.Constant) -> Iterable[ast.AST]:
    """Yield N±1 for integer constants (skipping 0 and bools)."""
    v = node.value
    if isinstance(v, bool) or not isinstance(v, int):
        return
    if v == 0:
        return
    yield ast.Constant(value=v + 1)
    yield ast.Constant(value=v - 1)


def mutate_binop(node: ast.BinOp) -> Iterable[ast.AST]:
    """Swap +↔−, *↔/."""
    swap = _BINOP_SWAP.get(type(node.op))
    if swap is None:
        return
    new = copy.deepcopy(node)
    new.op = swap()
    yield new


def mutate_return(node: ast.Return) -> Iterable[ast.AST]:
    """Replace `return <expr>` with `return None`."""
    if node.value is None:
        return
    if isinstance(node.value, ast.Constant) and node.value.value is None:
        return
    new = ast.Return(value=ast.Constant(value=None))
    yield new


def mutate_unaryop(node: ast.UnaryOp) -> Iterable[ast.AST]:
    """Drop `not x` → `x`."""
    if not isinstance(node.op, ast.Not):
        return
    yield copy.deepcopy(node.operand)


# --- Candidate collection -------------------------------------------------


class _DocstringSet:
    """Track ast.Constant nodes that are docstrings (first-stmt strings
    in module/function/class bodies). Those are excluded from mutation."""

    def __init__(self, tree: ast.Module) -> None:
        self.docstring_ids = set()
        self._scan_module(tree)

    def _scan_body(self, body: List[ast.stmt]) -> None:
        if not body:
            return
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            self.docstring_ids.add(id(first.value))

    def _scan_module(self, tree: ast.Module) -> None:
        self._scan_body(tree.body)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                                  ast.ClassDef)):
                self._scan_body(node.body)

    def __contains__(self, node: ast.AST) -> bool:
        return id(node) in self.docstring_ids


def collect_mutations(source: str) -> List[Mutation]:
    """Walk the source's AST and return a list of Mutation candidates."""
    tree = ast.parse(source)
    docstrings = _DocstringSet(tree)
    candidates: List[Mutation] = []

    def _add(kind: str, original: ast.AST, mutant: ast.AST,
             location: str) -> None:
        candidates.append(Mutation(
            kind=kind,
            node_id=id(original),
            location=location,
            original_repr=_safe_unparse(original),
            mutant_repr=_safe_unparse(mutant),
            parent_index=len(candidates),
        ))

    for node in ast.walk(tree):
        loc = f"line {getattr(node, 'lineno', '?')}"
        if isinstance(node, ast.Compare):
            for m in mutate_comparison(node):
                _add("comparison", node, m, loc)
        elif isinstance(node, ast.BinOp):
            for m in mutate_binop(node):
                _add("binop", node, m, loc)
        elif isinstance(node, ast.UnaryOp):
            for m in mutate_unaryop(node):
                _add("unaryop", node, m, loc)
        elif isinstance(node, ast.Return):
            for m in mutate_return(node):
                _add("return", node, m, loc)
        elif isinstance(node, ast.Constant) and node not in docstrings:
            for m in mutate_boolean_constant(node):
                _add("boolean", node, m, loc)
            for m in mutate_numeric_constant(node):
                _add("numeric", node, m, loc)
    return candidates


def _safe_unparse(node: ast.AST) -> str:
    """ast.unparse can fail on bare nodes; wrap defensively."""
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001
        return f"<unparse-failed:{type(node).__name__}>"


# --- Applying mutations ---------------------------------------------------


def apply_mutation(source: str, mutation: Mutation) -> str:
    """Return a mutated copy of `source` where the targeted node is
    replaced by its mutant. Pure: does not modify the input."""
    tree = ast.parse(source)
    docstrings = _DocstringSet(tree)

    # Walk in the same order as collect_mutations; pick the candidate
    # at parent_index.
    target_original: Optional[ast.AST] = None
    target_mutant: Optional[ast.AST] = None
    idx = 0
    for node in ast.walk(tree):
        for child_mutant in _enumerate_mutants(node, docstrings):
            if idx == mutation.parent_index:
                target_original = node
                target_mutant = child_mutant
                break
            idx += 1
        if target_original is not None:
            break

    if target_original is None or target_mutant is None:
        raise ValueError(f"could not locate mutation candidate {mutation!r}")

    class _Replacer(ast.NodeTransformer):
        def visit(self, node):  # noqa: D401
            if node is target_original:
                return target_mutant
            return super().visit(node)

    new_tree = _Replacer().visit(tree)
    ast.fix_missing_locations(new_tree)
    return ast.unparse(new_tree) + "\n"


def _enumerate_mutants(node: ast.AST,
                       docstrings: _DocstringSet) -> Iterable[ast.AST]:
    """Yield each mutant the operators would produce, in the SAME order
    as collect_mutations indexes them."""
    if isinstance(node, ast.Compare):
        yield from mutate_comparison(node)
    elif isinstance(node, ast.BinOp):
        yield from mutate_binop(node)
    elif isinstance(node, ast.UnaryOp):
        yield from mutate_unaryop(node)
    elif isinstance(node, ast.Return):
        yield from mutate_return(node)
    elif isinstance(node, ast.Constant) and node not in docstrings:
        yield from mutate_boolean_constant(node)
        yield from mutate_numeric_constant(node)


# --- Safe apply/restore ---------------------------------------------------


def _apply_with_restore(sut_path: Path,
                        mutation: Mutation,
                        runner: Callable[[], bool]) -> bool:
    """Write the mutated source to sut_path, call runner(), and ALWAYS
    restore the original bytes. Returns runner()'s result."""
    original_bytes = sut_path.read_bytes()
    try:
        source_text = original_bytes.decode("utf-8", errors="replace")
        mutated_source = apply_mutation(source_text, mutation)
        sut_path.write_text(mutated_source, encoding="utf-8")
        return runner()
    finally:
        sut_path.write_bytes(original_bytes)


# --- Kill-set runner ------------------------------------------------------


def kill_rate(killed: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return min(1.0, killed / total)


def run_kill_set(sut_path: Path,
                 test_command: List[str],
                 cwd: Optional[Path] = None,
                 timeout: int = DEFAULT_TIMEOUT_S,
                 progress: Optional[Callable[[int, int, MutationResult],
                                              None]] = None
                 ) -> Tuple[float, int, int, List[MutationResult]]:
    """Run the full mutation suite. Returns (rate, killed, total, details).

    Sanity check first: the test_command MUST pass on the un-mutated SUT.
    If it doesn't, we'd spuriously mark every mutant as "killed" because
    every subprocess returns non-zero. Raises RuntimeError if the baseline
    fails (this is the bug Cycle 18 hit with `--hypothesis-derandomize`).

    For determinism with Hypothesis properties, set HYPOTHESIS_DERANDOMIZE=1
    in the subprocess env — that makes property seeds a deterministic
    function of the test name, so kill rate is stable across runs.
    """
    import os as _os
    env = dict(_os.environ)
    env["HYPOTHESIS_DERANDOMIZE"] = "1"

    # Sanity: baseline test run must PASS on unmutated SUT
    baseline = subprocess.run(
        test_command, cwd=str(cwd) if cwd else None,
        capture_output=True, text=True, timeout=max(60, timeout),
        env=env,
    )
    if baseline.returncode != 0:
        head = (baseline.stdout + baseline.stderr)[:500]
        raise RuntimeError(
            "Baseline test run failed on unmutated SUT — mutation results "
            "would be meaningless. First 500 chars of pytest output:\n"
            f"{head}"
        )

    source = sut_path.read_text()
    candidates = collect_mutations(source)
    results: List[MutationResult] = []
    killed_count = 0

    for i, mut in enumerate(candidates):
        def _runner(_m=mut) -> bool:
            try:
                proc = subprocess.run(
                    test_command,
                    cwd=str(cwd) if cwd else None,
                    capture_output=True, text=True, timeout=timeout,
                    env=env,
                )
            except subprocess.TimeoutExpired:
                return True  # Treat hang as "killed"
            return proc.returncode != 0

        try:
            killed = _apply_with_restore(sut_path, mut, _runner)
        except Exception as e:  # noqa: BLE001
            res = MutationResult(mutation=mut, killed=False,
                                 notes=f"apply_with_restore raised: {e}")
        else:
            res = MutationResult(mutation=mut, killed=killed)
            if killed:
                killed_count += 1
        results.append(res)
        if progress:
            progress(i + 1, len(candidates), res)

    return (kill_rate(killed_count, len(candidates)),
            killed_count, len(candidates), results)


# --- Report rendering -----------------------------------------------------


def render_report(results: List[MutationResult], rate: float,
                  killed: int, total: int, sut_path: Path) -> str:
    lines = [
        f"# Mutation report — {sut_path.name}",
        "",
        f"Total mutations: **{total}** · killed: **{killed}** · "
        f"survived: **{total - killed}** · kill rate: **{rate:.2%}**",
        "",
        "## Per-mutant details",
        "",
        "| # | Kind | Location | Original → Mutant | Result |",
        "|---|---|---|---|---|",
    ]
    for i, r in enumerate(results):
        m = r.mutation
        verdict = "killed" if r.killed else "survived"
        if r.notes:
            verdict += f" ({r.notes})"
        ot = (m.original_repr or "").replace("|", "\\|")[:40]
        mt = (m.mutant_repr or "").replace("|", "\\|")[:40]
        lines.append(f"| {i+1} | {m.kind} | {m.location} | `{ot}` → `{mt}` | {verdict} |")
    return "\n".join(lines) + "\n"


# --- CLI ------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Homegrown mutation tester (Track T5 / FAIL-0011 option 3)"
    )
    parser.add_argument("--sut", default=str(DEFAULT_SUT))
    parser.add_argument("--tests", default=None,
                        help="Single test file path; default: tests/test_v4_hardening.py")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--report-out", default=str(DEFAULT_REPORT))
    parser.add_argument("--cwd", default=None,
                        help="cwd for the test subprocess (default: repo root)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S)
    parser.add_argument("--quiet", "-q", action="store_true")
    args = parser.parse_args(argv)

    sut = Path(args.sut)
    if not sut.exists():
        print(f"[mutate] SUT not found: {sut}", file=sys.stderr)
        return 2
    if args.tests:
        test_paths = [args.tests]
    else:
        test_paths = [str(p) for p in DEFAULT_TESTS if p.exists()]
    if not test_paths:
        print(f"[mutate] no test files found", file=sys.stderr)
        return 2

    cwd = Path(args.cwd) if args.cwd else REPO_ROOT
    # Run the entire kill set every time (no `-x`). With `-x`, the kill
    # set's first-test failure short-circuits the rest, making the kill
    # rate fluctuate based on which test happened to run first.
    test_command = ["python3", "-m", "pytest", "-q", "--no-cov",
                    "-p", "no:cacheprovider",
                    *test_paths]

    if not args.quiet:
        print(f"[mutate] SUT: {sut}")
        print(f"[mutate] test command: {' '.join(test_command)}")
        print(f"[mutate] cwd: {cwd}")

    def _on_progress(i: int, n: int, res: MutationResult) -> None:
        if args.quiet:
            return
        verdict = "K" if res.killed else "S"
        print(f"  [{i}/{n}] {verdict} {res.mutation.kind:11s} "
              f"{res.mutation.location:12s} "
              f"{res.mutation.original_repr[:30]:30s} -> "
              f"{res.mutation.mutant_repr[:30]}")

    rate, killed, total, results = run_kill_set(
        sut_path=sut, test_command=test_command, cwd=cwd,
        timeout=args.timeout,
        progress=_on_progress,
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(f"{rate:.4f}\n")

    report_out = Path(args.report_out)
    report_out.parent.mkdir(parents=True, exist_ok=True)
    report_out.write_text(render_report(results, rate, killed, total, sut))

    if not args.quiet:
        print(f"\n[mutate] kill rate: {rate:.2%} ({killed}/{total})")
        print(f"[mutate] wrote {out}")
        print(f"[mutate] wrote {report_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
