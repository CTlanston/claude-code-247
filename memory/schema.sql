-- claude-code-247 v1 state schema.
-- SQLite for v1; designed to migrate to Postgres later with minimal changes.
-- Every table has created_at TEXT (ISO-8601 UTC) for audit.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ────────────────────────────────────────────────────────────────────────
-- repos: mirror of ~/.claude-code-247/repos.yaml.
-- The YAML is canonical; this table makes joins/queries fast.
CREATE TABLE IF NOT EXISTS repos (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  github_owner    TEXT NOT NULL,
  github_repo     TEXT NOT NULL,
  local_path      TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  enabled         INTEGER NOT NULL DEFAULT 1,
  risk_level      TEXT NOT NULL DEFAULT 'low',
  config_json     TEXT NOT NULL,             -- full per-repo YAML, JSON-encoded
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ────────────────────────────────────────────────────────────────────────
-- tasks: per-repo unit of work.
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  goal            TEXT NOT NULL,
  source          TEXT NOT NULL,             -- dashboard | cli | remote | issue | proposal
  source_ref      TEXT,                      -- e.g. issue number or command id
  status          TEXT NOT NULL,             -- queued|planning|coding|...|merged|stuck|failed|paused|cancelled
  branch          TEXT,
  pr_number       INTEGER,
  risk_score      INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  finished_at     TEXT,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_repo_status ON tasks(repo_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);

-- ────────────────────────────────────────────────────────────────────────
-- task_events: every transition + log line tied to a task. Powers timeline.
CREATE TABLE IF NOT EXISTS task_events (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  event_type      TEXT NOT NULL,             -- created|planned|worker_started|...
  message         TEXT NOT NULL,
  payload_json    TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);

-- ────────────────────────────────────────────────────────────────────────
-- runs: one row per worker container run (a task may have multiple runs).
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  role            TEXT NOT NULL,             -- planner|coder|reviewer|guardian|repair|docs|validator
  container_id    TEXT,
  command_line    TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  exit_code       INTEGER,
  stdout_path     TEXT,
  stderr_path     TEXT,
  duration_ms     INTEGER,
  cost_estimate   REAL,
  auth_mode       TEXT,                      -- local_claude_code|anthropic_api|gemini|openai
  payload_json    TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, started_at);

-- ────────────────────────────────────────────────────────────────────────
-- commands: every CLI/dashboard/remote action is enqueued here for audit.
CREATE TABLE IF NOT EXISTS commands (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  source          TEXT NOT NULL,             -- cli|dashboard|remote|scheduled
  command_type    TEXT NOT NULL,             -- start_task|pause_repo|...
  repo_id         TEXT,
  task_id         TEXT,
  pr_number       INTEGER,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL,             -- queued|running|succeeded|failed|rejected|requires_approval
  result_json     TEXT,
  error           TEXT,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_status_created ON commands(status, created_at);

-- ────────────────────────────────────────────────────────────────────────
-- prs: track PRs we create, with their lifecycle.
CREATE TABLE IF NOT EXISTS prs (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  task_id         TEXT,
  pr_number       INTEGER NOT NULL,
  branch          TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  url             TEXT NOT NULL,
  state           TEXT NOT NULL,             -- draft|open|merged|closed
  approval_state  TEXT NOT NULL DEFAULT 'not_required', -- not_required|required|approved|rejected|expired
  risk_score      INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  merged_at       TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  UNIQUE(repo_id, pr_number)
);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ci_results (
  id              TEXT PRIMARY KEY,
  pr_id           TEXT,
  task_id         TEXT,
  workflow_name   TEXT,
  status          TEXT NOT NULL,             -- pending|success|failure|cancelled|skipped|neutral
  url             TEXT,
  created_at      TEXT NOT NULL,
  payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ci_pr ON ci_results(pr_id, created_at);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validator_results (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  pr_id           TEXT,
  validator       TEXT NOT NULL,             -- gemini|openai|mock
  verdict         TEXT NOT NULL,             -- PASS|FAIL|NEEDS_HUMAN
  confidence      REAL,
  summary         TEXT,
  blocking_issues_json    TEXT,
  non_blocking_issues_json TEXT,
  evidence_gaps_json      TEXT,
  recommended_next_action TEXT,
  raw_response_path TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_validator_task ON validator_results(task_id, created_at);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scores (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  pr_id           TEXT,
  score           INTEGER NOT NULL,
  level           TEXT NOT NULL,             -- low|medium|high
  factors_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- ────────────────────────────────────────────────────────────────────────
-- budgets: rolling per-repo counters.
CREATE TABLE IF NOT EXISTS budgets (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  date            TEXT NOT NULL,             -- YYYY-MM-DD
  tasks_count             INTEGER NOT NULL DEFAULT 0,
  worker_runs_count       INTEGER NOT NULL DEFAULT 0,
  validator_runs_count    INTEGER NOT NULL DEFAULT 0,
  repair_attempts_count   INTEGER NOT NULL DEFAULT 0,
  estimated_api_cost      REAL NOT NULL DEFAULT 0,
  local_cc_run_count      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  UNIQUE(repo_id, date)
);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  repo_id         TEXT,
  task_id         TEXT,
  pr_number       INTEGER,
  fingerprint     TEXT NOT NULL,             -- for dedup
  message         TEXT NOT NULL,
  channel         TEXT NOT NULL,             -- ntfy|log
  delivered       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_fingerprint_created ON notifications(fingerprint, created_at);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL,             -- info|warn|error|critical
  repo_id         TEXT,
  task_id         TEXT,
  fingerprint     TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 1,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint ON alerts(fingerprint);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  level           TEXT NOT NULL,             -- debug|info|warn|error
  component       TEXT NOT NULL,
  repo_id         TEXT,
  task_id         TEXT,
  run_id          TEXT,
  message         TEXT NOT NULL,
  payload_json    TEXT,
  fingerprint     TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_task ON logs(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_repo ON logs(repo_id, created_at);
-- FTS5 mirror for full-text search (used by `claude247 logs search`).
CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
  message, payload_json,
  content='logs', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS logs_fts_ins AFTER INSERT ON logs BEGIN
  INSERT INTO logs_fts(rowid, message, payload_json)
  VALUES (new.rowid, new.message, COALESCE(new.payload_json, ''));
END;
CREATE TRIGGER IF NOT EXISTS logs_fts_del AFTER DELETE ON logs BEGIN
  INSERT INTO logs_fts(logs_fts, rowid, message, payload_json)
  VALUES('delete', old.rowid, old.message, COALESCE(old.payload_json, ''));
END;

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_items (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  item_type       TEXT NOT NULL,             -- failure|review|decision|diff|incident|lesson
  text            TEXT NOT NULL,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  embedding_id    TEXT,                      -- pointer into vector store
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_repo_type ON memory_items(repo_id, item_type, created_at);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT,
  task_id         TEXT,
  topic           TEXT NOT NULL,
  decided_by      TEXT NOT NULL,             -- system|operator|approval
  decision        TEXT NOT NULL,
  rationale       TEXT,
  created_at      TEXT NOT NULL,
  payload_json    TEXT
);

-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT,
  task_id         TEXT,
  incident_type   TEXT NOT NULL,
  severity        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  resolved        INTEGER NOT NULL DEFAULT 0,
  resolved_at     TEXT,
  created_at      TEXT NOT NULL,
  payload_json    TEXT
);

-- ────────────────────────────────────────────────────────────────────────
-- system_state: simple key→value store for runtime flags the dispatcher
-- reads on each tick. Keys we use:
--   system.paused            "1" when stop-all / pause --system is active
--   repo.paused.<repo_id>    "1" when pause --repo is active
--   repo.dispatch_lock       (reserved) coarse-grained mutex
CREATE TABLE IF NOT EXISTS system_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ────────────────────────────────────────────────────────────────────────
-- worker_exits (M19/BR-003): structured per-phase exit records.
--
-- Before this table, dispatcher summaries said "worker_exit: 3" with no
-- way to tell whether claude CLI / docker / git / pytest / validator /
-- merge gate was the actual blocker. This table classifies each phase
-- end so explain-stuck + dashboard can answer "what stopped you".
CREATE TABLE IF NOT EXISTS worker_exits (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  repo_id         TEXT NOT NULL,
  run_id          TEXT,
  worker_role     TEXT NOT NULL,                -- runner|planner|coder|reviewer|repair|...
  phase           TEXT NOT NULL,                -- prepare_workspace|tests|lint|...|merge
  command         TEXT,
  exit_code       INTEGER,
  duration_ms     INTEGER,
  classification  TEXT NOT NULL,                -- success|test_failure|claude_cli_failure|...
  stdout_tail     TEXT,
  stderr_tail     TEXT,
  error_message   TEXT,
  retryable       INTEGER NOT NULL DEFAULT 0,
  next_action     TEXT,
  payload_json    TEXT,
  -- M21-P2: phase lifecycle fields (additive; older rows have these NULL)
  status          TEXT,                         -- in_progress|success|failure|skipped
  started_at      TEXT,                         -- ISO-8601 UTC
  finished_at     TEXT,                         -- ISO-8601 UTC
  error_type      TEXT                          -- Python exception class name when status=failure
);
CREATE INDEX IF NOT EXISTS idx_worker_exits_task ON worker_exits(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worker_exits_classification ON worker_exits(classification, created_at);
CREATE INDEX IF NOT EXISTS idx_worker_exits_task_phase ON worker_exits(task_id, phase, started_at);

-- ────────────────────────────────────────────────────────────────────────
-- schema_version: tracks migrations.
--   v1  initial M1 schema
--   v2  M11 added system_state
--   v3  M19/BR-003 added worker_exits
--   v4  M21-P2 added phase lifecycle fields to worker_exits
CREATE TABLE IF NOT EXISTS schema_version (
  version         INTEGER PRIMARY KEY,
  applied_at      TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
