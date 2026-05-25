# ADR-0003: SQLite State + Filesystem Evidence Bundles

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

aedev needs two distinct types of durable storage:

1. **Queryable state:** Tasks, missions, approvals, risk scores, validator
   results, secret grants, model usage accounting. This data is frequently
   read and filtered (e.g., "all tasks in WAITING state for repo X"), needs
   transactional consistency (a task state change and its corresponding
   approval record must be written atomically), and must survive daemon
   restarts.

2. **Human-readable audit trail:** For each task run, there is a body of
   evidence — the task plan, the changed files, the test results, the
   validator reports — that needs to be readable by humans and by external
   validators. This data is write-once (produced by the worker) and rarely
   queried structurally, but is frequently read in full.

We need to choose a storage technology for each category.

For queryable state, we evaluated: PostgreSQL, MongoDB, Redis, and SQLite.

For audit data, we evaluated: storing everything in the database (as JSON
blobs or separate columns), versus storing it as flat files on the filesystem.

---

## Decision

Use **SQLite via `better-sqlite3`** for all queryable state. Use **flat-file
evidence bundles** (markdown + JSON files on the filesystem) for per-task audit
data.

`better-sqlite3` is a synchronous SQLite binding for Node.js. Unlike the
asynchronous `node-sqlite3` package, it uses a synchronous API which is
idiomatic with the rest of our Node.js code when used inside Fastify's
synchronous route handlers and is not a problem at our concurrency scale
(single-daemon, limited concurrent workers).

Evidence bundles live at `~/.aedev/evidence/<task_id>/` and contain nine
markdown/JSON files (see `docs/architecture.md` for the full list). Validators
receive these files directly; they are not stored in or extracted from
the database.

---

## Alternatives Considered

### Queryable State Alternatives

#### PostgreSQL

**Pros:**
- Full ACID compliance with row-level locking
- Rich query capabilities (window functions, CTEs, full-text search)
- Widely understood; many developers know it well

**Cons:**
- Requires running a separate server process alongside the daemon; adds
  operational overhead for a single-user local tool
- Requires Postgres to be installed, started, and kept running (via launchd or
  Homebrew services) — another dependency to manage and another failure point
- Network socket communication adds latency vs. embedded SQLite
- Backups require `pg_dump`; restoring requires `pg_restore` — more complex
  than copying a file
- No meaningful advantage over SQLite at our scale: single-writer daemon,
  low concurrent read load, modest data volume (thousands of rows, not millions)

#### MongoDB

**Pros:**
- Document model maps naturally to JSON-heavy event data
- Schema-free makes early-stage development faster

**Cons:**
- Requires running a separate MongoDB server
- No transactional consistency guarantees in single-document operations across
  collections without multi-document transactions (added complexity)
- The document model does not add value here: our data is highly relational
  (tasks belong to missions, runs belong to tasks, approvals reference tasks
  and grants) and benefits from foreign keys and joins
- Schema-free is a disadvantage, not an advantage, for a state machine where
  illegal states must be rejected at the storage layer

#### Redis

**Pros:**
- Extremely fast; sub-millisecond reads/writes
- Native support for pub/sub (useful for SSE)
- Simple data structures (hashes, sorted sets) map to our state tables

**Cons:**
- In-memory primary store; durability requires enabling AOF or RDB
  persistence, which adds configuration and potential data loss on crash
- No relational model; simulating foreign key constraints requires
  application-level enforcement — a reliability risk for a state machine
- Cannot easily answer "give me all tasks where risk_score > 50 and state is
  WAITING" without maintaining secondary indexes by hand
- Another server process to manage

#### Files-Only (No Database)

**Pros:**
- Zero dependencies; everything is just files
- Git-committable state

**Cons:**
- Not queryable without reading and parsing every file
- No transactional consistency; partial writes leave state corrupt
- File locking on macOS is advisory, not mandatory — concurrent writes from
  multiple workers could corrupt state
- Prohibitively slow for status views that need to aggregate across all tasks

### Evidence Storage Alternatives

#### Store Everything in SQLite (JSON Blobs)

**Pros:**
- Single storage system; simpler backup
- Evidence is queryable alongside state data

**Cons:**
- Large TEXT blobs in SQLite (a full worker transcript can be hundreds of KB)
  inflate the database file and slow down unrelated queries
- Validators would need to read evidence through the daemon API rather than
  receiving files directly — adds coupling
- Evidence is harder to inspect: you need a SQLite client to read it instead
  of just `cat ~/.aedev/evidence/<task_id>/done-report.md`
- Git-committing evidence for long-term archival is awkward with binary SQLite
  blobs

#### Store Flat Files Alongside SQLite (Chosen)

**Pros:**
- Human-readable without any tooling
- Validators receive files directly; no API needed
- Evidence bundles can be git-committed to an archive repo for long-term audit
- File size does not affect SQLite query performance
- `cat`, `less`, and standard text tools work on evidence files

**Cons:**
- Two storage locations to keep in sync (SQLite row points to filesystem path)
- Filesystem evidence can be deleted independently of the SQLite record
  (mitigated by `aedev doctor` which checks for orphaned records and missing
  bundles)

---

## Consequences

### Positive

- **Zero-ops storage:** SQLite is an embedded library; no server to start,
  stop, or configure. The database is created automatically when the daemon
  starts for the first time.
- **Portable and atomic:** The entire state is a single `~/.aedev/state.db`
  file. Backup is `cp ~/.aedev/state.db ~/.aedev/state.db.bak`. Migration
  is copy-the-file.
- **WAL mode for concurrent reads:** SQLite WAL (Write-Ahead Logging) mode
  allows concurrent reads while a write is in progress. This means the CLI
  can read the database (for `aedev status` output) while the daemon is
  writing a task state transition — no lock contention.
- **Evidence readability:** An operator can inspect exactly what a worker did
  by reading the markdown files in the evidence directory, with no tooling
  beyond a text editor. This is critical for debugging failed tasks.
- **Validator simplicity:** Validators receive a directory path. They open
  the files directly. No API, no deserialization, no network call to the
  daemon.

### Negative

- **Single-writer constraint:** SQLite with WAL allows one writer at a time.
  If multiple daemon processes attempt to write simultaneously (e.g., after a
  crash recovery where the old process is still dying), writes queue behind
  the writer lock. This is acceptable for our single-daemon architecture but
  would be a scaling bottleneck if the design ever moves to multiple daemon
  processes.
- **No cloud-native replication:** SQLite does not natively replicate to a
  cloud backup. For disaster recovery, the user must set up their own
  `state.db` backup strategy (e.g., a launchd job that copies the file to
  iCloud Drive). aedev provides `aedev doctor` with a backup-recency check
  but does not perform backups itself.
