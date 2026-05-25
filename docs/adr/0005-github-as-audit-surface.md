# ADR-0005: GitHub as Collaboration and Audit Surface Only

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

The previous claude-code-247 v1 system used GitHub extensively as a control
surface: workflows were scheduled via GitHub Actions cron, worker state was
partially tracked in PR comments, and merges were initiated by GitHub Actions
jobs. This created several problems:

- **Slow feedback loops:** GitHub Actions cold start is 30–60 seconds. A task
  that should take 5 minutes was preceded by a minute of waiting for a runner
  to become available.
- **State drift:** The authoritative state of a task was split between SQLite
  (local) and GitHub PR state/comments. When they diverged (due to network
  errors, rate limits, or webhook delivery failures), debugging required
  reconciling both sources.
- **Control plane coupling:** Changes to scheduling behavior required editing
  workflow YAML files in `.github/workflows/`. This mixed infrastructure
  concerns into the repository that the system manages.
- **Rate limit sensitivity:** Heavy use of the GitHub API (polling PR state,
  posting comments, creating checks) consumed GitHub API rate limits quickly,
  especially for repos with frequent task runs.

We need to clarify GitHub's role in aedev: what it provides, what it does not
control, and how we handle divergence.

---

## Decision

GitHub is used exclusively as a collaboration and audit surface. It receives
information from aedev but does not drive aedev's behavior.

**GitHub receives (aedev pushes):**
- Branch pushes (one branch per task: `aedev/<mission_slug>/<task_id>`)
- Pull request creation with structured body text including risk score,
  merge policy, and task description
- Check status updates (pending → in_progress → success/failure) via the
  GitHub Checks API
- Evidence summary comments (a human-readable digest of the evidence bundle,
  posted as a collapsible PR comment)
- Issue imports (existing GitHub issues can be pulled and converted to mission
  drafts via `aedev intake --from-issue <issue_number>`)

**GitHub does not:**
- Trigger task scheduling or worker dispatch
- Hold the authoritative state of any task (SQLite is authoritative)
- Drive merge decisions (the daemon makes merge decisions; it then calls the
  GitHub API to execute the merge if `allow_remote_writes: true`)
- Run aedev workers (no GitHub Actions involved in the worker execution path)

**Divergence handling:** If the GitHub PR state (e.g., whether a check is
marked passing) diverges from the SQLite task state, SQLite wins. The daemon
has a periodic reconciliation job that re-syncs check statuses and PR labels
from SQLite to GitHub, not the reverse.

---

## Alternatives Considered

### 1. Keep GitHub Actions as the Primary Control Plane (v1 Approach)

**Pros:**
- GitHub Actions is available 24/7 regardless of Mac uptime
- Built-in secrets management (GitHub Secrets) for CI/CD
- Webhook-driven architecture is reactive; no polling needed
- Standard CI/CD integration; other developers on the team can see and
  understand the automation by reading the workflow files

**Cons:**
- Cold start latency (30–60s per job) is unacceptable for a system designed
  to run tasks continuously. A scheduling loop that checks for new tasks every
  minute becomes a 90-second minimum latency between task detection and worker
  start.
- Persistent state is not supported in GitHub Actions without external storage.
  Every job starts fresh, which means state must be re-read from GitHub's API
  (PR state, issue state) on every invocation — costly in API calls and latency.
- No local Claude Code subscription reuse. Workers run in GitHub's compute
  environment, which cannot use the user's macOS-installed Claude subscription.
  Every worker invocation requires the paid Anthropic API.
- The scheduling granularity of GitHub Actions cron is 1-minute minimum, and
  GitHub may delay cron jobs by several minutes during high load periods.
- Workflow files in `.github/workflows/` become a complex control plane that
  is difficult to modify safely (changes require PRs, CI runs, merge — slow
  feedback on infrastructure changes).
- Rate limit sensitivity: posting a PR comment, creating a check, updating
  labels, and reading PR state for every task run accumulates quickly into
  GitHub API rate limit pressure.

### 2. Hybrid: GitHub Actions for Scheduling, Local Daemon for Execution

**Pros:**
- Uses GitHub for what it's good at (scheduling, webhook delivery) while
  keeping execution local

**Cons:**
- Adds complexity: the daemon must receive webhook calls from GitHub Actions,
  which requires either a public webhook endpoint (not available on a local
  Mac without a tunnel) or polling GitHub for dispatch events
- The scheduling-local-execution boundary creates a latency gap: GitHub fires
  the schedule event, the local daemon polls for it, then dispatches the worker
  — multiple network round-trips in the critical scheduling path
- Still requires the paid Anthropic API for any execution that happens in
  GitHub's compute environment (e.g., PR checks that run validators)
- More complex failure modes: scheduling and execution failures are in different
  systems with different observability tools

---

## Consequences

### Positive

- **Fast local scheduling:** The daemon's scheduler runs in memory. New tasks
  are dispatched within milliseconds of becoming available, not after a
  30–60 second CI cold start.
- **Offline capability:** The system continues to schedule and run tasks when
  network access to GitHub is unavailable. GitHub sync (branch push, PR
  creation, check updates) is queued and retried with exponential backoff when
  connectivity returns.
- **Single source of truth:** SQLite holds all state. GitHub state is derived.
  Debugging a task state discrepancy requires looking at one place (`aedev task
  view <id>`) rather than reconciling SQLite, GitHub PR state, PR comments, and
  workflow run logs.
- **No GitHub API rate limit on the critical path:** Scheduling decisions are
  local. The GitHub API is only called when publishing results (branch push,
  PR create, check update, evidence comment) — a bounded number of calls per
  task completion, not on every scheduling tick.
- **No GitHub Actions cost:** Execution happens on the user's local machine.
  No GitHub Actions minutes are consumed.

### Negative

- **GitHub UI shows limited task progress:** The GitHub PR for a task shows:
  branch status (pushed or not), PR description, check status (pending /
  running / success / failure), and the evidence comment (when posted). It
  does not show real-time worker progress (log lines, current action). For
  real-time progress, the operator uses `aedev status` or the dashboard.
  This is a deliberate tradeoff: GitHub is for audit and collaboration, not
  live monitoring.
- **Eventual consistency with GitHub:** There is a delay between when a task
  completes locally and when the PR is created/updated on GitHub. During
  network outages, this delay can be indefinite. The operator can force a sync
  with `aedev sync <task_id>`.
- **No GitHub Actions as a fallback execution environment:** If the user's Mac
  is unavailable, no tasks run. This is a consequence of the local-first
  design decision (ADR-0001) and is acceptable for the single-user local
  development use case.
