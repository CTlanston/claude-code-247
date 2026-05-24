from __future__ import annotations

from orchestrator.secret_scanner import has_secrets, scan


def test_clean_diff_no_hits() -> None:
    diff = """\
+def add(a, b):
+    return a + b
"""
    assert scan(diff) == []
    assert has_secrets(diff) is False


def test_github_pat_in_addition() -> None:
    diff = "+TOKEN = 'ghp_" + "a" * 36 + "'\n"
    hits = scan(diff)
    assert hits
    assert hits[0].pattern == "github_token"


def test_anthropic_key_caught() -> None:
    diff = "+ANTHROPIC_API_KEY = 'sk-ant-" + "x" * 40 + "'\n"
    assert has_secrets(diff)


def test_pem_header_caught() -> None:
    diff = "+-----BEGIN RSA PRIVATE KEY-----\n+abc\n"
    hits = scan(diff)
    assert any(h.pattern == "private_key" for h in hits)


def test_only_additions_skips_unchanged_lines() -> None:
    diff = " API_KEY=ghp_" + "a" * 36 + "\n"
    assert scan(diff, only_additions=True) == []
    assert scan(diff, only_additions=False)


def test_env_var_addition_caught() -> None:
    diff = "+API_KEY=actually-a-secret\n"
    hits = scan(diff)
    assert hits and hits[0].pattern == "env_var_assign"


def test_m19_f1_lowercase_python_var_not_flagged_as_env_var() -> None:
    """M19-F1: the env_var_assign regex previously used (?im), which
    matched ordinary lowercase Python variable names like
    ``tokens = text.split()``. This produced a false-positive
    REDACTION on the diff body during the M19 Phase 5 live E2E. The
    fix removes the case-insensitive flag so only conventional
    uppercase env-var-style identifiers match.
    """
    # Realistic line that hit the false positive in production
    assert scan("+    tokens = text.split()\n") == []
    # Similar lowercase variants must also be clean
    assert scan("+secret_text = redact()\n") == []
    assert scan("+password_hash = derive(salt)\n") == []
    # Mixed case shouldn't fire either
    assert scan("+Token = make()\n") == []


def test_m19_f1_uppercase_env_var_still_caught() -> None:
    """Regression guard for the legitimate match the M19-F1 fix must
    preserve. SECRET / API_KEY / TOKEN / PASSWORD in ALL CAPS at the
    start of an added line is still an env-var-style secret."""
    for line in (
        "+SECRET_TOKEN=value\n",
        "+API_KEY=abcdef\n",
        "+TOKEN=ghp_aaaaaaaaaaaa\n",
        "+PASSWORD=hunter2\n",
        "+PASSWORD_HASH=abcdef\n",
    ):
        hits = scan(line)
        assert hits and hits[0].pattern == "env_var_assign", \
            f"missed legitimate env-var line: {line!r}"
