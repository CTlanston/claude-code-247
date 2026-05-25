# ADR-0001: Local-First Daemon Architecture

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

We need a system that can autonomously execute engineering tasks 24/7, manage
state across multiple runs and multiple repositories, dispatch workers on demand,
and provide a responsive operator interface. The system must reuse the user's
existing Claude Code subscription to avoid per-token API costs on every worker
invocation.

The key design tension is: where does the "brain" live? Options range from
cloud-hosted orchestration (which keeps the Mac out of the critical path) to
fully local execution (which requires the Mac to stay on but eliminates
cloud dependencies and cost per run).

We evaluated three alternative architectures:

**GitHub Actions only:** Use GitHub Actions workflows as the scheduling
mechanism. A cron workflow triggers on schedule, creates a dispatch event, and
a workflow job runs the Claude worker.

**Cloud-hosted agent (AWS Lambda + SQS):** Run an orchestrator Lambda that
polls an SQS queue. Workers run as Lambda functions or Fargate tasks. State
stored in DynamoDB or RDS.

**Container-only (Docker daemon + orchestrator in Docker):** Run the
orchestrator itself inside a Docker container on the Mac, with Docker-in-Docker
for worker containers.

---

## Decision

Run aedev as a native local daemon process on the user's Mac, managed by macOS
launchd. The daemon is a Node.js Fastify process. Workers run in Docker
containers spawned by the daemon. All state is stored in SQLite on the local
filesystem.

launchd is responsible for:
- Starting the daemon on user login
- Restarting it automatically if it crashes
- Waking it when the Mac resumes from sleep

---

## Alternatives Considered

### 1. GitHub Actions Only

**Pros:**
- No infrastructure to manage; GitHub provides the compute
- Built-in CI/CD integration; checks and PRs are native
- Free CI minutes on public repos; no Mac needs to stay on
- Authentication is straightforward via GITHUB_TOKEN

**Cons:**
- Cold start latency of 30–60 seconds per job (unacceptable for rapid iteration)
- No persistent in-memory state; every job starts fresh
- Cannot reuse the user's local Claude Code subscription — would need the paid
  Anthropic API for every worker run, adding per-token cost at scale
- No local file system access; all repo access goes through GitHub's API or
  a fresh clone
- Scheduling granularity is limited to cron syntax (1-minute minimum)
- Cannot run indefinitely; GitHub enforces a 6-hour job limit and 35-day
  cron gap-detection that cancels inactive workflows

### 2. Cloud-Hosted Agent (AWS Lambda + SQS)

**Pros:**
- Truly always-on; independent of Mac uptime
- Scales to multiple workers without bottleneck on a single machine
- Standard cloud architecture with established operational patterns

**Cons:**
- Complex deployment and infrastructure management (VPC, IAM, secrets in
  AWS Secrets Manager, Fargate task definitions)
- Secrets must be stored in cloud services, not local Keychain — increases
  attack surface and operational overhead
- Cannot reuse the user's local Claude Code subscription — all API calls go
  through the paid Anthropic API
- Network round-trip latency for every state mutation (DynamoDB writes, SQS
  polls)
- SaaS complexity: billing, IAM policy drift, service limits, cold starts on
  Lambda
- Overkill for a single-user local development tool

### 3. Container-Only (Docker Daemon + Orchestrator in Docker)

**Pros:**
- Strong isolation; orchestrator itself is containerized
- Reproducible environment

**Cons:**
- Docker-in-Docker adds complexity (bind-mount `/var/run/docker.sock` or use
  a nested Docker daemon); both approaches have security or complexity tradeoffs
- macOS Docker Desktop adds file system latency via the gRPC FUSE layer;
  running the orchestrator inside Docker compounds this
- Cannot directly reuse the user's macOS Keychain for secret storage without
  complex socket proxying
- Adding a layer of container indirection to the orchestrator without isolation
  benefit (it still runs on the same Mac)

---

## Consequences

### Positive

- **Local Claude Code subscription reuse:** Workers run `claude` CLI on the
  host (mounted into the container), which uses the user's existing Claude
  subscription. No per-token API cost for primary workers.
- **Sub-second task dispatch:** The daemon is an in-memory process; dispatching
  a new worker takes only the Docker container startup time (~1–3 seconds), not
  a cold-start latency of 30–60 seconds.
- **Full local file system access:** The daemon can read and write to any local
  path. Workers receive mounted worktrees. No round-trips to GitHub for file
  access.
- **Offline capability:** The system continues to run tasks when network access
  is unavailable. GitHub sync (branch push, PR creation) is deferred and retried
  when connectivity returns.
- **No third-party hosting:** No cloud billing, no IAM policies, no service
  limits from external providers on the scheduling path.
- **SQLite simplicity:** State is a single file. Backups are `cp`. Inspection
  requires no special tooling.

### Negative

- **Requires Mac to stay on:** If the Mac sleeps or shuts down, in-progress
  tasks pause at the next Docker checkpoint. Workers that were actively running
  when the Mac slept will have their containers suspended; they resume on wake
  unless Docker killed them.
- **Single-machine availability:** There is no high-availability failover. If
  the Mac has a hardware failure, the system is unavailable.

### Mitigating Factors

- launchd ensures the daemon restarts automatically on Mac wake and after
  crashes, with no manual intervention.
- The hold-on-blocker protocol handles transient failures gracefully: tasks
  that were interrupted record a HOLD entry and are retried on resume.
- Evidence bundles are written incrementally, so a task interrupted mid-run
  has partial evidence available for debugging.
- For single-user local development (the primary use case), single-machine
  availability is acceptable. High-availability requirements indicate a
  different product category.
