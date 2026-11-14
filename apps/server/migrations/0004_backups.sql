CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  relative_path TEXT UNIQUE,
  file_size INTEGER CHECK (file_size IS NULL OR file_size > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK (
    (relative_path IS NULL AND file_size IS NULL AND sha256 IS NULL AND completed_at IS NULL)
    OR (relative_path IS NOT NULL AND file_size IS NOT NULL AND sha256 IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX ix_backups_character ON backups(character_id, created_at DESC);
