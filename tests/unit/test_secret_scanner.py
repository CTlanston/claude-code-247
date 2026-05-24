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
