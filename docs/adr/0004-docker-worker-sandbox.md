# ADR-0004: Docker Worker Sandbox

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

aedev workers run the Claude Code CLI and execute arbitrary code in a target
repository. Workers may run scripts from the target repo, install tools, modify
files, and take other actions with side effects. Key requirements for worker
execution:

- **Secret isolation:** A worker for Task A must not be able to read secrets
  that were granted only to Task B, or ambient host environment variables that
  contain credentials.
- **Filesystem isolation:** A worker must not modify host system files, other
  repos' working directories, or daemon state files.
- **Reproducibility:** A failed task must be replayable from its evidence
  bundle in a consistent environment.
- **Auditability:** The daemon must know exactly what files a worker changed,
  which requires the worker to operate on a controlled, observable filesystem.
- **Clean state between runs:** A retry of a failed task must not be
  contaminated by leftover state from the previous attempt.

We evaluated four isolation approaches.

---

## Decision

Each task runs in a Docker container. The container is created from a managed
image (`aedev-worker:latest`) that contains: Node.js, git, the `gh` CLI,
and the Claude Code CLI. The daemon mounts two directories into the container:

1. The git worktree for the target repository (`~/.aedev/evidence/<task_id>/worktree/`) — read-write
2. The evidence output directory (`~/.aedev/evidence/<task_id>/`) — read-write

The container has no default environment variables beyond what is needed to
run the Claude CLI (PATH, HOME). Secrets are injected as explicit environment
variables only when a valid `secret_grant` exists.

The container communicates results back to the daemon exclusively by writing
files to the mounted evidence output directory. It does not call back to the
daemon over a socket. When the container exits (zero or non-zero), the daemon
reads the output directory to determine success or failure.

---

## Alternatives Considered

### 1. Bare Node.js Child Process

**Pros:**
- Simplest possible approach; no Docker required
- Sub-millisecond startup; no container overhead
- Direct access to host filesystem; no mount configuration

**Cons:**
- No filesystem isolation; a worker can read and write any file the daemon
  process has access to, including other task worktrees, `~/.aedev/state.db`,
  and any other local files
- No environment isolation; the child process inherits the parent's full
  environment, including all exported variables (`ANTHROPIC_API_KEY`,
  `GITHUB_TOKEN`, etc.)
- No resource limits; a misbehaving worker can consume unlimited CPU, memory,
  or disk
- No clean state between runs; leftover files from a failed run persist in
  the shared filesystem

### 2. macOS sandbox-exec

**Pros:**
- Native macOS mechanism; no additional software required
- Fine-grained policy control (can specify allowed read/write paths,
  allowed network destinations, allowed system calls)

**Cons:**
- `sandbox-exec` uses the Apple Sandbox profile language (SBPL), a complex
  DSL that is not well-documented outside of Apple internals; steep learning
  curve
- Profiles must be maintained for each version of macOS, which changes sandbox
  semantics between releases
- Does not provide environment variable isolation; secrets in the host
  environment are still visible to sandboxed processes
- Not portable to Linux (relevant if workers are ever moved to a Linux server)
- Process startup is not significantly faster than Docker on macOS
- Apple treats `sandbox-exec` as a private API; it is not guaranteed to
  remain available or stable

### 3. Virtual Machine (QEMU)

**Pros:**
- Strongest possible isolation; kernel-level boundary between host and guest
- No way for a compromised worker to escape to the host system

**Cons:**
- Heavy startup: a QEMU VM takes 10–30 seconds to boot, even with a minimal
  Linux image. This is unacceptable for tasks that might run tens of times per
  day
- High memory overhead: even a minimal Linux VM requires 512MB–1GB of RAM.
  With multiple concurrent workers, this would exhaust typical Mac RAM budgets
- Managing VM images (creation, updates, cleanup) is significantly more complex
  than Docker image management
- No meaningful security benefit over Docker for our threat model (workers are
  not assumed to be actively hostile — they are Claude agents running known
  prompts; the isolation requirement is to prevent accidental leakage, not
  to contain a purposefully adversarial process)

### 4. Firecracker MicroVM

**Pros:**
- Very fast startup (~125ms) compared to QEMU
- Strong isolation (separate kernel per microVM)
- Used by AWS Lambda for this exact use case

**Cons:**
- Requires KVM, which is not available on macOS (Firecracker runs on Linux
  only). Our primary deployment target is macOS.
- Adds significant infrastructure complexity (Jailer, drive image management,
  networking setup)
- Solving the "macOS-only" problem would require either: running Firecracker
  inside a Linux VM on the Mac (double-virtualization overhead), or maintaining
  a separate Linux machine for worker execution (defeats the local-first goal)

---

## Consequences

### Positive

- **Secret isolation by default:** Docker containers do not inherit the host
  environment. A worker that is not granted a specific secret cannot access
  it, even if the operator accidentally left a credential in their shell
  profile. This is the most important security property of this decision.
- **Strong filesystem isolation:** The worker can only access the mounted
  worktree and evidence directories. It cannot read `~/.aedev/state.db`,
  other task worktrees, or host system files.
- **Reproducible environment:** The `aedev-worker` Docker image pins specific
  versions of Node.js, git, gh CLI, and Claude CLI. Every worker for every
  task runs in the same environment, making replay reliable.
- **Clean state on retry:** Each run creates a fresh container from the image.
  No leftover state from the previous run contaminates the retry.
- **Resource limits:** Docker container resource constraints (`--cpus`, `--memory`)
  prevent a misbehaving worker from starving other workers or the daemon process.

### Negative

- **Docker Desktop must be running on macOS:** Docker Desktop for Mac is a
  commercial product (free for personal use) that adds a ~200MB background
  process. Users must install and keep it running. If Docker Desktop is not
  running, the daemon can still start and serve the dashboard, but no workers
  can be dispatched. `aedev doctor` checks for Docker availability.
- **Container startup latency:** Creating and starting a Docker container takes
  approximately 1–3 seconds on a modern Mac. This is acceptable for tasks that
  run for minutes, but would be noticeable if tasks ran in under 10 seconds.
  For aedev's use case (coding tasks that typically take 5–30 minutes), this
  overhead is negligible.
- **Docker image maintenance:** The `aedev-worker` image must be updated when
  Claude CLI releases new versions, when base OS security patches are needed,
  or when new tooling is required. This is a maintenance burden mitigated by
  automated image builds and a `latest` tag pointing to the most recent tested
  image.
- **macOS Docker networking overhead:** Docker Desktop for Mac uses a Linux VM
  under the hood (HyperKit or Apple's Virtualization.framework depending on
  version), which adds file system latency for bind mounts compared to native
  Linux Docker. Benchmarks show ~2–5x slower file I/O on macOS Docker mounts
  vs. native. For aedev workers, which do sequential file operations (not
  random I/O at high throughput), this is acceptable.
