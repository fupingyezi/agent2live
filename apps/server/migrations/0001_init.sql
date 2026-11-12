CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'character', 'job', 'agent', 'system')),
  scope_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_log_scope ON event_log(scope_kind, scope_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
  space_id TEXT partition key,
  memory_id TEXT,
  embedding float[768] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  tokenize = 'unicode61'
);
