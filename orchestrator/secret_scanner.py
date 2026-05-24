"""Quick scan for secret-like tokens in a diff string.

Not a substitute for proper secret scanning (truffleHog / gitleaks), but
enough to catch obvious mistakes before a worker pushes. Patterns cover
the formats we see most often.

Used by the merge_policy gate AND by the dashboard's PR detail page.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

SECRET_PATTERNS: dict[str, str] = {
    "aws_access_key": r"AKIA[0-9A-Z]{16}",
    "aws_secret_key": r"(?i)aws.{0,20}(secret|access).{0,20}[\"\'][0-9A-Za-z/+=]{40}[\"\']",
    "github_token": r"gh[pousr]_[A-Za-z0-9]{30,}",
    "anthropic_key": r"sk-ant-[a-zA-Z0-9_-]{20,}",
    "openai_key": r"sk-[A-Za-z0-9]{20,}",
    "gemini_key": r"AIza[0-9A-Za-z_-]{30,}",
    "slack_token": r"xox[abprs]-[A-Za-z0-9-]{10,}",
    "private_key": r"-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----",
    "pem_header": r"-----BEGIN CERTIFICATE-----",
    "env_var_assign": r"(?im)^[+\s]*(SECRET|API_KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+",
}


@dataclass(frozen=True)
class SecretHit:
    pattern: str
    line: str
    line_no: int

    def to_dict(self) -> dict:
        return {"pattern": self.pattern, "line_no": self.line_no,
                 "snippet": self.line[:200]}


def scan(text: str, *, only_additions: bool = True) -> list[SecretHit]:
    """Return matches grouped by pattern. When ``only_additions`` is true
    (default) we only look at lines starting with '+'."""
    hits: list[SecretHit] = []
    for ln_no, raw in enumerate(text.splitlines(), start=1):
        if only_additions and not raw.startswith("+"):
            continue
        for name, rx in SECRET_PATTERNS.items():
            if re.search(rx, raw):
                hits.append(SecretHit(pattern=name, line=raw, line_no=ln_no))
                break  # one hit per line is enough
    return hits


def has_secrets(text: str) -> bool:
    return bool(scan(text))
