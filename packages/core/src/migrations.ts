import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: string
  /** Optional pragma-style guard: when it returns true the SQL is skipped
   *  (but the migration is still recorded). Needed for ALTER TABLE ADD COLUMN,
   *  which SQLite cannot express idempotently and which survives the Stage M
   *  rollback drills that only delete migration rows. */
  skipIf?: (db: Database.Database) => boolean
}

const INITIAL_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  github_owner TEXT,
  github_repo TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  test_commands TEXT NOT NULL DEFAULT '[]',
  forbidden_paths TEXT NOT NULL DEFAULT '[]',
  risk_rules TEXT NOT NULL DEFAULT '{}',
  merge_policy TEXT NOT NULL DEFAULT 'WAITING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roadmaps (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repos(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  prd_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT REFERENCES roadmaps(id),
  repo_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  risk_level TEXT,
  prd_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_number INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT REFERENCES tasks(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  runner_mode TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  exit_code INTEGER,
  evidence_dir TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  required_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_scores (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  run_id TEXT REFERENCES runs(id),
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  factors TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS validator_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  validator TEXT NOT NULL,
  verdict TEXT NOT NULL,
  summary TEXT,
  evidence_bundle_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT REFERENCES runs(id),
  auth_mode TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_task_id TEXT REFERENCES tasks(id),
  source_mission_id TEXT REFERENCES missions(id),
  repo_id TEXT REFERENCES repos(id),
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secret_grants (
  id TEXT PRIMARY KEY,
  secret_name TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  ttl_seconds INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revoked_at TEXT,
  revoke_reason TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`

// v3 introduces the v2.1 event_log table — single append-only ledger that
// will become the source of truth (see ADR-0010). The legacy `events` table
// is preserved unchanged per GROUND RULE 4 (schema dual-compatibility); a
// later migration will demote it to a view computed from event_log.
const V3_EVENT_LOG_SQL = `
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  idempotency TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  causation_id TEXT,
  correlation_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_log_task_ts ON event_log(task_id, ts);
CREATE INDEX IF NOT EXISTS idx_event_log_kind ON event_log(kind);
CREATE INDEX IF NOT EXISTS idx_event_log_causation ON event_log(causation_id);
`

const V4_OPERATOR_COCKPIT_SQL = `
CREATE TABLE IF NOT EXISTS operator_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repos(id),
  mission_id TEXT REFERENCES missions(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'brainstorming',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_artifacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_messages_session ON operator_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mission_artifacts_mission ON mission_artifacts(mission_id, type);
`

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial-schema', up: INITIAL_SQL },
  { version: 2, name: 'add-github-fields', up: `
  ALTER TABLE missions ADD COLUMN github_branch TEXT;
  ALTER TABLE missions ADD COLUMN github_pr_url TEXT;
  ALTER TABLE missions ADD COLUMN github_pr_number INTEGER;
` },
  { version: 3, name: 'event-log-v2', up: V3_EVENT_LOG_SQL },
  { version: 4, name: 'operator-cockpit', up: V4_OPERATOR_COCKPIT_SQL },
  { version: 5, name: 'operator-message-choices', up: `ALTER TABLE operator_messages ADD COLUMN choices TEXT;` },
  { version: 6, name: 'operator-questions-meta-holds', up: `
ALTER TABLE operator_messages ADD COLUMN questions TEXT;
ALTER TABLE operator_messages ADD COLUMN meta TEXT;
CREATE TABLE IF NOT EXISTS holds (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  next_action TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_holds_entity ON holds(entity_type, entity_id, status);
` },
  // v5-P1 (ADR-0023): operator identity on the legacy events table. Nullable
  // on purpose — historical rows are NOT rewritten; readers treat NULL as
  // 'owner' (COALESCE at query time), so GR#5 rebuilds stay intact.
  { version: 7, name: 'v5-p1-events-operator-id',
    up: `ALTER TABLE events ADD COLUMN operator_id TEXT;`,
    skipIf: (db) => (db.prepare('PRAGMA table_info(events)').all() as { name: string }[])
      .some((c) => c.name === 'operator_id') },
  // v5-P2 (ADR-0022/0023): BYO fleet worker registry + nonce idempotency table.
  // fleet_workers stores public-key identity only — never tokens/credentials.
  // fleet_nonces is the replay guard: PRIMARY KEY (worker_id, nonce) makes a
  // signed request first-write-wins; response_json caches the claim response
  // so a replayed claim is idempotent instead of double-assigning.
  { version: 8, name: 'v5-p2-fleet-workers',
    up: `
CREATE TABLE IF NOT EXISTS fleet_workers (
  worker_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fleet_nonces (
  worker_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (worker_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_fleet_workers_status ON fleet_workers(status);
`,
    skipIf: (db) => !!db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fleet_workers'",
    ).get() },
]

export function runMigrations(db: Database.Database): void {
  // create migrations table first (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`)
  const applied = db.prepare('SELECT version FROM migrations').all() as { version: number }[]
  const appliedVersions = new Set(applied.map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (!appliedVersions.has(m.version)) {
      if (!m.skipIf?.(db)) db.exec(m.up)
      db.prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version, m.name, new Date().toISOString()
      )
    }
  }
}

export function getMigrationVersion(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT MAX(version) as v FROM migrations').get() as { v: number | null }
    return row.v ?? 0
  } catch {
    return 0
  }
}
