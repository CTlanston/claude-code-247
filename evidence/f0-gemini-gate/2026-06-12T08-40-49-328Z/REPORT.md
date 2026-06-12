# F0 Gemini Gate Evidence (operator-provided summary; ingested by cloud loop)
Date: 2026-06-12T08:41:10.275Z · Model: gemini-2.5-pro · Result: PASS

Verdicts (REAL Gemini API on real diffs):
- good diff: pass — low-risk README doc update, confined to plan, tests pass, evidence consistent.
- bad diff: fail — severe plan deviation: auth code deleted, CI/CD workflow modified, secrets file added; failing tests; forbidden-path violations.

Provenance (GR#7): produced on the operator Mac with a real AEDEV_GEMINI_API_KEY.
Full bundles (good-bundle/, bad-bundle/, gemini-good-verdict.json, gemini-bad-verdict.json)
remain on the operator machine — push them into this directory to complete the artifact set.
Classification: REAL (verdict summary in repo); bundles pending operator push.
