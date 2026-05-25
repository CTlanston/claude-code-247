# ADR-0002: TypeScript + Node.js as Implementation Language

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

The previous claude-code-247 v1 system is implemented in Python (asyncio,
FastAPI, Pydantic). aedev is a ground-up redesign. We need to choose an
implementation language for the new system.

Key requirements that influence the language choice:

- Strong type safety for the state machine code, where illegal transitions
  and schema mismatches cause silent bugs that are hard to detect at runtime
- A good async story for managing multiple concurrent Docker workers and
  SSE event fans
- An ecosystem that aligns with the dashboard technology (we are building a
  React/Vite dashboard as a first-class component, not an afterthought)
- A pnpm workspace monorepo model where the dashboard can import type
  definitions directly from the backend packages — no code generation step
- Developer familiarity and ecosystem maturity for the specific libraries
  we need: better-sqlite3, Octokit, Fastify, commander, Vitest

We also considered the Python v1 codebase as a starting point (extend rather
than rewrite), but the dashboard requirement and the desire for end-to-end
type safety make this impractical without a significant re-architecture anyway.

---

## Decision

Implement aedev in TypeScript strict mode, targeting Node.js 20 LTS (with a
migration path to Node.js 24 LTS when it becomes available). Use pnpm
workspaces as the monorepo manager.

TypeScript `strict: true` means all of the following compiler flags are on:
`strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`,
`strictPropertyInitialization`, `noImplicitAny`, `noImplicitThis`,
`alwaysStrict`. This eliminates an entire class of null-reference and type
mismatch bugs in state machine transitions.

---

## Alternatives Considered

### 1. Python (asyncio + mypy + FastAPI) — Extend or Rewrite

**Pros:**
- The v1 system is already Python; existing prompts, patterns, and scripts
  can be reused as references
- asyncio is mature and well-understood for concurrent I/O
- mypy + Pydantic provide reasonable runtime and static type checking
- The team has existing Python familiarity from v1

**Cons:**
- Python's type inference is weaker than TypeScript's. mypy can be configured
  to be strict, but the type system has structural gaps (e.g., TypedDict
  vs. dataclass vs. Pydantic model are three parallel ways to do the same
  thing with subtly different semantics)
- Sharing types between the backend and a React dashboard requires a code
  generation step (e.g., generating TypeScript interfaces from Pydantic models).
  This adds friction and a potential source of drift
- pnpm workspaces is a TypeScript/JS concept; a Python monorepo requires
  different tooling (Poetry workspaces or uv workspaces), adding complexity
- The v1 codebase has accumulated technical debt and implicit coupling that
  makes it difficult to extend cleanly; a Python rewrite would not significantly
  improve on this
- asyncio's event loop model requires care to avoid blocking the loop with
  synchronous SQLite calls; better-sqlite3's synchronous API (a positive for
  our use case) does not exist in Python's ecosystem

### 2. Go

**Pros:**
- Excellent performance; goroutines are lightweight and the scheduler handles
  concurrency efficiently
- Strong static typing with simple generics
- Single binary distribution; no runtime to install
- Excellent for systems-level work

**Cons:**
- No direct ecosystem alignment with React/Vite dashboard; TypeScript types
  would need to be generated from Go structs (openapi-gen or similar)
- The Go ecosystem for the specific libraries we need (SQLite, GitHub, SSE)
  is mature but less rich than Node.js (fewer opinionated batteries-included
  choices; more assembly required)
- Error handling in Go (explicit `err` returns) is verbose for complex state
  machine code with many failure modes
- pnpm workspace monorepo is not applicable; we would need a mixed
  Go + TypeScript monorepo, which adds significant tooling complexity

### 3. Rust

**Pros:**
- Best-in-class performance and memory safety
- Excellent type system; the borrow checker eliminates data races at compile time
- Growing ecosystem (tokio, sqlx, axum)

**Cons:**
- High learning barrier for contributors who do not already know Rust;
  ownership and lifetimes add significant cognitive load compared to the
  problem complexity of an engineering OS orchestrator
- Compile times are slow, which hurts iteration speed during development
- No direct ecosystem alignment with React/Vite dashboard; same type-sharing
  problem as Go
- SQLite bindings (rusqlite) are mature but the ergonomics of mapping SQLite
  rows to Rust structs is more verbose than better-sqlite3 in TypeScript
- For this problem domain (I/O-bound orchestration, not CPU-bound computation),
  the Rust performance advantage over Node.js is not material

---

## Consequences

### Positive

- **End-to-end type safety:** TypeScript types defined in `packages/core` are
  imported directly by the daemon, CLI, and dashboard. No code generation step.
  A schema change in `packages/core` causes type errors across all consumers
  immediately, surfacing drift at compile time instead of runtime.
- **State machine correctness:** TypeScript's discriminated unions and
  exhaustive switch checking make it possible to prove at compile time that all
  state transition paths are handled. An unhandled state transition is a
  compile error, not a runtime exception.
- **pnpm workspaces:** The monorepo model is a first-class concept in the
  Node.js ecosystem. Package linking, shared configs, and workspace-aware
  commands (`pnpm --filter @aedev/daemon test`) work well with TypeScript
  projects.
- **Dashboard type sharing:** React components in `apps/dashboard` can import
  `Task`, `Mission`, `ApprovalRequest`, and other types directly from
  `packages/core`. The dashboard is always in sync with the backend schema.
- **Vitest:** TypeScript-native test runner with first-class ESM support,
  workspace mode, and fast watch mode. No separate Babel/Jest configuration
  needed.
- **Node.js 20 LTS availability:** Node 20 is widely available on macOS today
  via Homebrew or nvm. Node 24 LTS (our target) is on the roadmap and will be
  a straightforward upgrade.

### Negative

- **Larger CLI binary:** A compiled TypeScript Node.js CLI is larger than a
  native Go or Rust binary. `aedev` will be distributed as a Node.js package
  (installed via `npm install -g @aedev/cli` or `pnpm install -g @aedev/cli`)
  rather than a self-contained executable. This is an acceptable tradeoff for
  our use case (single-user local tool; not distributed to end users without
  Node.js already installed).
- **Node.js runtime required:** Users must have Node.js 20+ installed. This is
  mitigated by the fact that aedev requires Docker, git, gh CLI, and Claude CLI
  — Node.js is a minor additional prerequisite, and `aedev doctor` checks for it.
- **Python v1 skill mismatch:** Contributors who built v1 in Python will need
  to work in TypeScript. The v1 code is preserved in `archive/auto-evo/` as
  reference, but is not imported or extended.
