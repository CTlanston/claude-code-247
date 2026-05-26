# ADR-0009: `aedev` as Primary Control Plane, Python `claude247` as Compatibility Kernel

**Status:** Accepted
**Date:** 2026-05-25
**Supersedes:** [ADR-0008](0008-product-spine-python-now-typescript-experimental.md)

---

## Context

[ADR-0008](0008-product-spine-python-now-typescript-experimental.md) stabilised the dual-codebase state on 2026-05-25 by labelling Python `claude247` "production GA" and TypeScript `aedev` "experimental prototype". That decision was correct at the time: the TypeScript runtime threw `ExperimentalFeatureError` on its happy path, and the Python runtime had 19 passing GA gates plus weeks of soak.

Since ADR-0008 was written, the product direction has expanded:

- The system is no longer scoped to "autonomous coding". It must deliver complete Web product increments — PRD intake, architecture, design, parallel build, visual QA via Playwright, external preview deployments to Cloudflare Pages / Vercel, low-risk auto-merge, low-risk production deploy with direct revert, multi-day autonomy with daily summaries.
- That expanded surface is the design intent of the `aedev` TypeScript control plane (pnpm monorepo, Fastify daemon, typed SQLite state machine, Vite+React dashboard, role-based agents).
- The Python `claude247` runtime is mature and battle-tested for the subset it already covers — Docker worker execution, headless `claude --print` invocation, Gemini + OpenAI judge orchestration, GitHub PR creation, risk scoring, merge policy. It was not designed to host the full product-OS surface.
- Forcing all new product-OS work through Python would either bloat Python beyond its design or block the roadmap behind a TS rewrite of subsystems that already work in Python.

Continuing to label `aedev` as an "experimental prototype" misrepresents the intent. The honest framing is that `aedev` is the primary product control plane *now*, and Python `claude247` is a compatibility execution kernel underneath it until TypeScript runtime reaches parity.

---

## Decision

**`aedev` is the primary control plane for the product OS, starting from this commit.**

**Python `claude247` is a compatibility execution kernel — invoked by `aedev` — until the TypeScript runtime reaches parity on worker execution, validator orchestration, and GitHub integration.**

Concretely:

1. **Default runtime paths are real, not placeholders.** `ClaudeCodeAdapter.run()` and `DockerRunner.run()` execute real subprocesses (no `ExperimentalFeatureError` on the default path).

2. **`ExperimentalFeatureError` is retained as a typed class** for unreachable / disabled optional adapters only (e.g., an alternate runner that is not selected by the active runner mode). It must not be thrown on a configured happy path.

3. **A bridge package — `@aedev/claude247-bridge` — connects the two kernels.** `aedev` enqueues work, polls task status from the Python state DB, and imports evidence from the Python workspace tree. The bridge is the only place TS code shells out to Python.

4. **Python `claude247` v1.0.0 GA remains accurate as the historical release record.** It is not retracted. It is reframed as the kernel that ships *under* the `aedev` control plane during the parity window.

5. **All safety invariants from ADR-0008 remain in force.** They are re-asserted here for clarity:
   - `MergePolicy.decide()` never returns `AUTO_MERGE` unless two independent validators both return `pass` and risk score is low (< 30). Inconclusive or stub validators do not count.
   - `IntakeService` requires `requestApproval()` followed by a distinct `approveMission()` call. No component may self-approve.
   - Auth/payment/security/deployment changes use a sensitive lane (stronger tests, dual validator PASS, preview evidence, rollback plan, no secret-scan hits).
   - Production deploy requires a healthcheck URL and direct-revert capability.

6. **`docs/aedev-prototype-status.md` is reframed** from "prototype gates that must turn green before TS replaces Python" to "TS runtime parity gates against the Python compatibility kernel". The bridge stays in tree for rollback safety even after parity.

---

## Alternatives Considered

**Keep ADR-0008 in force and delay product-OS work.** Rejected. The product roadmap requires the new control plane (PRD intake, design, visual QA, preview deploy, multi-day autonomy). Delaying perpetuates the prototype framing while the design diverges further from reality.

**Delete `aedev` and extend Python `claude247` to cover the full product-OS surface.** Rejected. TypeScript was chosen in [ADR-0002](0002-typescript-node.md) for type safety, package boundaries, and first-class integration with the Vite+React dashboard. Reversing that decision would forfeit the architectural investment and complicate the frontend/CLI/daemon contract.

**Promote `aedev` to sole runtime immediately; deprecate Python.** Rejected. `aedev` has no production track record for worker execution or validator orchestration. The Python runtime has 19 passing GA gates and ~9h healthy soak. Discarding it now would forfeit a known-good kernel and forfeit the validator + risk orchestration that already works.

**Edit ADR-0008 in place to flip its position.** Rejected. ADRs are append-only by convention. Superseding via a new ADR preserves the historical record of why the position changed and when.

---

## Consequences

**Positive:**

- Product-OS roadmap can proceed without a Python rewrite of the worker / validator / GitHub layers.
- Python's mature subsystems keep delivering value during the parity window.
- `aedev` users are no longer told the system is "experimental" — they see a real control plane backed by a real (though Python-implemented) kernel.
- Each kernel can be replaced independently; the bridge is the explicit contract.

**Negative / trade-offs:**

- The bridge adds an IPC boundary (process management, SQLite polling, filesystem evidence reads). It is a place things can break.
- Two codebases must stay buildable until parity. Migration is not free.
- Errors from the Python side must be surfaced cleanly into TS log streams and the `aedev` dashboard.

**Migration trigger (revised from ADR-0008):**

The TS runtime parity gates in `docs/aedev-prototype-status.md` must turn green before the bridge can be retired. Even after parity, the bridge stays in tree for one full minor-version cycle as a rollback path. Retirement of the bridge is itself a separate ADR.

**Backwards compatibility:**

- The `claude247` Python CLI continues to work standalone for operators who prefer it. Nothing in this ADR removes a Python command.
- The `aedev` CLI is the recommended entry point for new product-OS work.
- All Python release artefacts (`RELEASE_NOTES_GA.md`, `M22_GA_DECISION_REPORT.md`, etc.) remain in tree as historical record.
