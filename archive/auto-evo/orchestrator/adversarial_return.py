"""Canonical module path for the S-L7 adversarial_return_check safety gate.

The actual implementation (`KNOWN_FINDING_CATEGORIES` + the
`validate_adversarial_review_contract` inspector) lives in
`orchestrator/adversarial_reviewer.py` to keep all subagent-return
logic in one place. This file is the discovery path that
`scripts/compute_level.py` looks for to count the gate as active.

Re-exports are identity-equal to the originals — there is no copy.
The shim exists purely so that future readers (and the level
computer) find the gate at the expected canonical path.

See also:
- `runner/roles/adversarial_reviewer.md` — subagent role schema
- `orchestrator/adversarial_reviewer.py` — implementation + dataclasses
- `tests/test_adversarial_return.py` — canonical-path tests
- `tests/test_adversarial_return_check.py` — substance tests (Cycle 34)
"""
from __future__ import annotations

from orchestrator.adversarial_reviewer import (
    KNOWN_FINDING_CATEGORIES,
    _KNOWN_FINDING_CATEGORIES,
    validate_adversarial_review_contract,
)

__all__ = [
    "KNOWN_FINDING_CATEGORIES",
    "_KNOWN_FINDING_CATEGORIES",
    "validate_adversarial_review_contract",
]
