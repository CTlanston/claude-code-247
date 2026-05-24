"""Stable ID helpers.

Tasks, commands, runs, etc. use short ULIDs prefixed with their type so an
ID is self-describing in logs. Tasks look like ``task_01HRX...``, commands
look like ``cmd_01HRX...``, and so on.

We don't pull in the `ulid-py` package — sqlite3 already gives us
millisecond clocks and `secrets` gives us randomness. Format: 26 chars of
Crockford base32 (timestamp ms + entropy), same shape as a ULID.
"""
from __future__ import annotations

import os
import secrets
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_crockford(value: int, length: int) -> str:
    out = ""
    for _ in range(length):
        out = _CROCKFORD[value & 0x1F] + out
        value >>= 5
    return out


def ulid() -> str:
    """Return a 26-char ULID."""
    ts_ms = int(time.time() * 1000)
    ts_part = _encode_crockford(ts_ms, 10)
    rand = int.from_bytes(secrets.token_bytes(10), "big")
    rand_part = _encode_crockford(rand, 16)
    return ts_part + rand_part


def make_id(prefix: str) -> str:
    """Build a self-describing ID like ``task_01HRX...``."""
    return f"{prefix}_{ulid()}"


def utc_now_iso() -> str:
    """ISO-8601 UTC with millisecond precision."""
    # Avoid datetime imports just for one format string.
    ms = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms)) + f".{int((ms % 1) * 1000):03d}Z"


def env_user() -> str:
    """Best-effort current user identifier for audit fields."""
    return os.environ.get("USER") or os.environ.get("LOGNAME") or "unknown"
