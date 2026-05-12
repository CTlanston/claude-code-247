"""Hypothesis property tests for orchestrator.billable.

Per L7 §9 / §6 Track T2: T-dim L4 requires property-based tests on
>= 3 modules. This is module 1/3 (the other two will be preflight and
_check_tdd_invariant, in later cycles).

Properties tested:
1. is_subscription_mode is a pure function of env (same input → same output)
2. to_billable_cost(...) is always >= 0 — billing is never negative
3. Under subscription mode, output is always 0 regardless of raw input
4. Under API mode, the helper never INFLATES cost (output <= raw, with
   the zero-token clamp respected)
5. The zero-token guard fires uniformly in both modes when both tokens
   are 0 (output = 0)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Skip the whole module if hypothesis isn't installed — keeps the
# baseline pytest run green even on a fresh checkout that hasn't yet
# run `pip install -r requirements-dev.txt`.
hypothesis = pytest.importorskip("hypothesis")
from hypothesis import given, settings, strategies as st  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import billable  # noqa: E402


# Reasonable bounds for the property search space:
# - Cost: USD figures from $0 to $1000 (well above any single-call estimate)
# - Tokens: 0 to 1,000,000 (well above any single-call value)
# - Special values: include NaN-adjacent and negative inputs to test clamping
RAW_COST = st.floats(min_value=-100.0, max_value=1000.0,
                     allow_nan=False, allow_infinity=False)
TOKEN_COUNT = st.integers(min_value=0, max_value=1_000_000)

# Plausible env dicts: keys may or may not be present, values are random
# short strings. We focus on the two keys billable.py actually consults.
ENV_VALUE = st.one_of(
    st.none(),
    st.text(min_size=0, max_size=64),
    st.sampled_from([
        "sk-ant-api03-xxx",
        "sk-ant-oat01-xxx",
        "",
        "totally-bogus",
    ]),
)


def _env_dict(api_key, oauth_token):
    """Construct an env dict skipping None values (matches os.environ semantics)."""
    env = {}
    if api_key is not None:
        env["ANTHROPIC_API_KEY"] = api_key
    if oauth_token is not None:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token
    return env


@given(api_key=ENV_VALUE, oauth_token=ENV_VALUE)
def test_is_subscription_mode_is_pure_function_of_env(api_key, oauth_token):
    """Same env → same result (idempotent), and never raises."""
    env = _env_dict(api_key, oauth_token)
    r1 = billable.is_subscription_mode(env)
    r2 = billable.is_subscription_mode(env)
    r3 = billable.is_subscription_mode(dict(env))  # fresh copy
    assert r1 is r2 or r1 == r2
    assert r1 == r3
    assert isinstance(r1, bool)


@given(raw=RAW_COST, in_tok=TOKEN_COUNT, out_tok=TOKEN_COUNT,
       api_key=ENV_VALUE, oauth_token=ENV_VALUE)
@settings(max_examples=200)
def test_to_billable_cost_is_never_negative(raw, in_tok, out_tok,
                                            api_key, oauth_token):
    """Billing is never negative regardless of inputs."""
    env = _env_dict(api_key, oauth_token)
    out = billable.to_billable_cost(raw, in_tokens=in_tok,
                                     out_tokens=out_tok, env=env)
    assert out >= 0.0
    assert isinstance(out, float)


@given(raw=RAW_COST, in_tok=TOKEN_COUNT, out_tok=TOKEN_COUNT)
def test_subscription_mode_always_zeros_billable(raw, in_tok, out_tok):
    """Whenever the env signals subscription, output is 0 regardless of inputs."""
    sub_env = {"CLAUDE_CODE_OAUTH_TOKEN": "any-value"}
    out = billable.to_billable_cost(raw, in_tokens=in_tok,
                                     out_tokens=out_tok, env=sub_env)
    assert out == 0.0

    # Same property via the prefix path
    sub_env_via_prefix = {"ANTHROPIC_API_KEY": "sk-ant-oat01-anything"}
    out2 = billable.to_billable_cost(raw, in_tokens=in_tok,
                                      out_tokens=out_tok,
                                      env=sub_env_via_prefix)
    assert out2 == 0.0


@given(raw=st.floats(min_value=0.0, max_value=1000.0,
                     allow_nan=False, allow_infinity=False),
       in_tok=st.integers(min_value=1, max_value=1_000_000),
       out_tok=st.integers(min_value=1, max_value=1_000_000))
def test_api_mode_never_inflates_cost(raw, in_tok, out_tok):
    """In API mode with positive tokens, billable <= raw (no inflation)."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-anything"}
    out = billable.to_billable_cost(raw, in_tokens=in_tok,
                                     out_tokens=out_tok, env=api_env)
    assert out <= raw + 1e-9  # tiny epsilon for float comparison
    assert out >= 0.0


@given(raw=RAW_COST, api_key=ENV_VALUE)
def test_zero_token_guard_forces_zero(raw, api_key):
    """In_tokens=0 AND out_tokens=0 forces output to 0, even in API mode
    (CLI ghost-cost on early-exit)."""
    api_env = {"ANTHROPIC_API_KEY": api_key} if api_key else {}
    out = billable.to_billable_cost(raw, in_tokens=0, out_tokens=0,
                                     env=api_env)
    assert out == 0.0


def test_subscription_detection_examples():
    """Concrete examples to anchor the property-test space."""
    assert billable.is_subscription_mode({"CLAUDE_CODE_OAUTH_TOKEN": "x"}) is True
    assert billable.is_subscription_mode(
        {"ANTHROPIC_API_KEY": "sk-ant-oat01-abc"}) is True
    assert billable.is_subscription_mode(
        {"ANTHROPIC_API_KEY": "sk-ant-api03-abc"}) is False
    assert billable.is_subscription_mode({}) is False
