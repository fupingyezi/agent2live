-- Core domain schema. Times are Unix ms; booleans are 0/1.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  active_brief_version_id TEXT REFERENCES character_brief_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
);

CREATE TABLE character_brief_versions (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  parent_version_id TEXT REFERENCES character_brief_versions(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (schema_version = 'character-brief/1'),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','imported','derived_confirmed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_character_brief_versions_character
  ON character_brief_versions(character_id, created_at);
CREATE INDEX ix_character_brief_versions_parent
  ON character_brief_versions(parent_version_id);

CREATE TRIGGER trg_character_brief_parent_same_character
BEFORE INSERT ON character_brief_versions
WHEN NEW.parent_version_id IS NOT NULL
 AND (SELECT character_id FROM character_brief_versions WHERE id = NEW.parent_version_id) <> NEW.character_id
BEGIN SELECT RAISE(ABORT, 'CHARACTER_BRIEF_PARENT_MISMATCH'); END;

CREATE TABLE art_projects (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR length(description) <= 4000),
  stage TEXT NOT NULL CHECK (stage IN ('idea_draft','prompt_draft','prompt_ready','generating','candidate_review','art_version_active','live2d_pending','blocked')),
  active_version_id TEXT REFERENCES art_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  active_prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
);
CREATE INDEX ix_art_projects_character ON art_projects(character_id, deleted_at, created_at);

CREATE TABLE project_forks (
  id TEXT PRIMARY KEY,
  child_project_id TEXT NOT NULL UNIQUE REFERENCES art_projects(id) ON DELETE RESTRICT,
  parent_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  root_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('prompt_version','art_version')),
  source_version_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  branch_label TEXT NOT NULL CHECK (length(branch_label) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('active','detached')),
  created_at INTEGER NOT NULL,
  detached_at INTEGER,
  CHECK (child_project_id <> parent_project_id),
  CHECK ((status = 'active' AND detached_at IS NULL) OR (status = 'detached' AND detached_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_forks_branch_active
  ON project_forks(parent_project_id, lower(branch_label)) WHERE status = 'active';
CREATE INDEX ix_forks_parent ON project_forks(parent_project_id, status);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  width INTEGER CHECK (width IS NULL OR width >= 0),
  height INTEGER CHECK (height IS NULL OR height >= 0),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE asset_provenance (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload','ai_generated','imported','derived')),
  original_name TEXT CHECK (original_name IS NULL OR length(original_name) <= 255),
  source_ref TEXT,
  license TEXT CHECK (license IS NULL OR length(license) <= 500),
  consent TEXT CHECK (consent IS NULL OR length(consent) <= 500),
  model_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_provenance_asset ON asset_provenance(asset_id, created_at);

CREATE TABLE asset_links (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('prompt_input','prompt_version','layer_spec','model')),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('identity_reference','style_reference','outfit_reference','color_reference','background_reference','pose_reference','sketch','texture','other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  weight REAL NOT NULL CHECK (weight >= 0.1 AND weight <= 2.0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_asset_links_owner ON asset_links(owner_type, owner_id, sort_order);
CREATE INDEX ix_asset_links_asset ON asset_links(asset_id);
CREATE UNIQUE INDEX ux_asset_links_prompt_version_asset
  ON asset_links(owner_id, asset_id) WHERE owner_type = 'prompt_version';
CREATE UNIQUE INDEX ux_asset_links_prompt_version_order
  ON asset_links(owner_id, sort_order) WHERE owner_type = 'prompt_version';

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('chat','image')),
  adapter TEXT NOT NULL CHECK (adapter IN ('openai-compatible','seedream','mock')),
  base_url TEXT CHECK (base_url IS NULL OR length(base_url) <= 500),
  model TEXT CHECK (model IS NULL OR length(model) <= 200),
  secret_ref TEXT CHECK (secret_ref IS NULL OR secret_ref LIKE 'sec_%'),
  config_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CHECK (adapter IN ('mock','seedream') OR base_url IS NOT NULL),
  CHECK (adapter IN ('mock','openai-compatible') OR kind = 'image'),
  CHECK (adapter <> 'seedream' OR kind = 'image')
);

CREATE TABLE provider_invocations (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('prompt.reverse','prompt.suggestion','image.generate')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
  model TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_units INTEGER,
  output_units INTEGER,
  error_code TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX ix_provider_invocations_connection ON provider_invocations(connection_id, started_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','leased','running','waiting_user','succeeded','failed','retrying','cancelled','unknown_outcome')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  idempotency_key TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_until INTEGER,
  cancel_requested_at INTEGER,
  next_attempt_at INTEGER,
  checkpoint_json TEXT,
  error_json TEXT,
  result_json TEXT,
  side_effect TEXT NOT NULL DEFAULT 'idempotent' CHECK (side_effect IN ('idempotent','non_idempotent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_jobs_claim ON jobs(status, next_attempt_at, created_at);
CREATE INDEX ix_jobs_lease ON jobs(status, lease_until);
CREATE INDEX ix_jobs_type ON jobs(type, status);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  type TEXT NOT NULL CHECK (type IN ('log','progress','done','error')),
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(job_id, seq)
);
CREATE INDEX ix_job_events_job ON job_events(job_id, seq);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER
);

CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_json TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','failed')),
  request_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  before_hash TEXT CHECK (before_hash IS NULL OR length(before_hash) = 64),
  after_hash TEXT CHECK (after_hash IS NULL OR length(after_hash) = 64),
  metadata_json TEXT NOT NULL
);
CREATE INDEX ix_audit_target ON audit_events(target_type, target_id, at);
CREATE INDEX ix_audit_action ON audit_events(action, at);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status_code INTEGER,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (scope, key)
);
CREATE INDEX ix_idempotency_created ON idempotency_keys(created_at);

CREATE TRIGGER trg_forks_same_character
BEFORE INSERT ON project_forks
WHEN (SELECT character_id FROM art_projects WHERE id = NEW.parent_project_id)
  <> (SELECT character_id FROM art_projects WHERE id = NEW.child_project_id)
BEGIN
  SELECT RAISE(ABORT, 'FORK_CHARACTER_MISMATCH');
END;

CREATE TRIGGER trg_forks_root_matches
BEFORE INSERT ON project_forks
WHEN NEW.status = 'active'
 AND EXISTS (SELECT 1 FROM project_forks p WHERE p.child_project_id = NEW.root_project_id)
BEGIN
  SELECT RAISE(ABORT, 'FORK_ROOT_INVALID');
END;
