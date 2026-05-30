# E2E-1 — Real End-to-End Loop Proof

Result: PASS
Target: CTlanston/multi-agent-brainstorm (draft-only, never merged)
Coder: subscription Claude in Docker (claude-code-247/runner:e2e1), ANTHROPIC_* stripped

## Acceptance (objective)
- runs >= 1: 1
- validator_results >= 2: 2 (gemini:pass, openai:pass)
- dual independent families: gemini+openai
- model_usage >= 1: 1; tokens in/out = 18/4013; cost = $0.2727
- merge decision: AUTO_MERGE (risk 0)
- draft PR: #13 https://github.com/CTlanston/multi-agent-brainstorm/pull/13 (isDraft=undefined, state=open)

## model_usage rows
- claude-docker/? auth=local_claude_code in=18 out=4013 cost=$0.27266215

## Coder changed paths
- README.md
- tests/readme_running_tests.test.js

## Timeline
- target=CTlanston/multi-agent-brainstorm image=claude-code-247/runner:e2e1 db=/Users/lanston/projects/cc247-e2e1/evidence/e2e/s1/e2e1-proof.db
- validator secrets: gemini=true openai=true
- claude subscription OAuth token loaded (108 chars); injected as CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_* stripped in-container
- mission 01KSVNP53Q1W0CWH8HZJA0JVVP approved
- running mission (real claude in docker + real dual-family validators)...
- run done: status=done decision=AUTO_MERGE risk=0 validators=2
-   validator gemini: pass
-   validator openai: pass
- audit: runs=1 validator_results=2 model_usage=1 (events=1) tokens in/out=18/4013 cost=$0.27266215
- coder changed paths: README.md, tests/readme_running_tests.test.js
- PR branch aedev-e2e1/readme-running-tests-mprwuc19 ready (2 in-scope file(s)); origin -> GitHub
- draft PR #13 https://github.com/CTlanston/multi-agent-brainstorm/pull/13 (isDraft=undefined state=open reused=false)
- verified PR #13: isDraft=true state=OPEN mergedAt=null

## Safety invariants
- Claude auth materialized from keychain, mounted read-only, scrubbed after; ANTHROPIC_* stripped in-container (no paid-API fallback); global allow_remote_writes never modified; PR is a draft and was never merged.
