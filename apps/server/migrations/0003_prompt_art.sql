CREATE TABLE prompt_input_submissions (
  id TEXT PRIMARY KEY,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  draft_id TEXT NOT NULL REFERENCES prompt_drafts(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  character_brief_version_id TEXT REFERENCES character_brief_versions(id) ON DELETE RESTRICT,
  global_notes TEXT CHECK (global_notes IS NULL OR length(global_notes) <= 8000),
  requirements_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  UNIQUE(art_project_id, revision)
);
CREATE INDEX ix_prompt_inputs_brief ON prompt_input_submissions(character_brief_version_id);

CREATE TABLE prompt_drafts (
  id TEXT PRIMARY KEY,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active','committed','superseded')),
  state_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  input_submission_id TEXT REFERENCES prompt_input_submissions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  base_version_id TEXT REFERENCES prompt_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  UNIQUE(art_project_id, revision)
);
CREATE UNIQUE INDEX ux_prompt_drafts_active ON prompt_drafts(art_project_id) WHERE status = 'active';
CREATE INDEX ix_prompt_drafts_project ON prompt_drafts(art_project_id, revision DESC);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  parent_version_id TEXT REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  parent_project_version_id TEXT,
  origin_version_id TEXT,
  input_submission_id TEXT NOT NULL REFERENCES prompt_input_submissions(id) ON DELETE RESTRICT,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE(art_project_id, version_number)
);
CREATE INDEX ix_prompt_versions_project ON prompt_versions(art_project_id, created_at);
CREATE INDEX ix_prompt_versions_parent ON prompt_versions(parent_version_id);

CREATE TABLE prompt_reverse_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  input_submission_id TEXT NOT NULL REFERENCES prompt_input_submissions(id) ON DELETE RESTRICT,
  base_draft_id TEXT NOT NULL REFERENCES prompt_drafts(id) ON DELETE RESTRICT,
  base_draft_revision INTEGER NOT NULL CHECK (base_draft_revision >= 1),
  base_draft_row_version INTEGER NOT NULL CHECK (base_draft_row_version >= 1),
  base_content_hash TEXT NOT NULL CHECK (length(base_content_hash) = 64),
  state_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('ready','applied','discarded')),
  provider_invocation_id TEXT NOT NULL REFERENCES provider_invocations(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  CHECK ((status = 'applied' AND applied_at IS NOT NULL) OR (status <> 'applied' AND applied_at IS NULL))
);
CREATE INDEX ix_prompt_reverse_project ON prompt_reverse_results(art_project_id, status, created_at);
CREATE INDEX ix_prompt_reverse_draft ON prompt_reverse_results(base_draft_id, created_at);

CREATE TABLE prompt_suggestions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  base_kind TEXT NOT NULL CHECK (base_kind IN ('prompt_version','prompt_draft')),
  base_version_id TEXT REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  base_draft_id TEXT REFERENCES prompt_drafts(id) ON DELETE RESTRICT,
  base_draft_revision INTEGER,
  base_draft_row_version INTEGER,
  base_content_hash TEXT NOT NULL CHECK (length(base_content_hash) = 64),
  operations_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  intent TEXT NOT NULL CHECK (length(intent) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','stale')),
  accepted_draft_id TEXT REFERENCES prompt_drafts(id) ON DELETE RESTRICT,
  accepted_draft_revision INTEGER,
  provider_invocation_id TEXT NOT NULL REFERENCES provider_invocations(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  CHECK (
    (base_kind = 'prompt_version'
      AND base_version_id IS NOT NULL
      AND base_draft_id IS NULL AND base_draft_revision IS NULL AND base_draft_row_version IS NULL)
    OR
    (base_kind = 'prompt_draft'
      AND base_version_id IS NULL
      AND base_draft_id IS NOT NULL AND base_draft_revision IS NOT NULL AND base_draft_row_version IS NOT NULL)
  ),
  CHECK (
    (status = 'accepted' AND accepted_draft_id IS NOT NULL AND accepted_draft_revision IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status IN ('rejected','stale') AND accepted_draft_id IS NULL AND accepted_draft_revision IS NULL AND resolved_at IS NOT NULL)
    OR (status = 'proposed' AND accepted_draft_id IS NULL AND accepted_draft_revision IS NULL AND resolved_at IS NULL)
  )
);
CREATE INDEX ix_prompt_suggestions_version ON prompt_suggestions(base_version_id, created_at);
CREATE INDEX ix_prompt_suggestions_draft ON prompt_suggestions(base_draft_id, created_at);
CREATE INDEX ix_prompt_suggestions_status ON prompt_suggestions(status, created_at);

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  base_art_version_id TEXT REFERENCES art_versions(id) ON DELETE RESTRICT,
  provider_connection_id TEXT REFERENCES provider_connections(id) ON DELETE RESTRICT,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_generation_jobs_project ON generation_jobs(art_project_id, created_at);

CREATE TABLE generation_candidates (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','accepted','rejected','expired')),
  accepted_art_version_id TEXT REFERENCES art_versions(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_generation_candidates_job ON generation_candidates(generation_job_id, status);

CREATE TABLE art_versions (
  id TEXT PRIMARY KEY,
  art_project_id TEXT NOT NULL REFERENCES art_projects(id) ON DELETE RESTRICT,
  parent_version_id TEXT REFERENCES art_versions(id) ON DELETE RESTRICT,
  origin_version_id TEXT,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  source_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  canvas_transform_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE(art_project_id, version_number)
);
CREATE INDEX ix_art_versions_project ON art_versions(art_project_id, created_at);
CREATE INDEX ix_art_versions_parent ON art_versions(parent_version_id);

-- Immutability guards. Delete is also blocked; soft-deleted projects keep versions.
CREATE TRIGGER trg_prompt_versions_no_update
BEFORE UPDATE ON prompt_versions
BEGIN SELECT RAISE(ABORT, 'PROMPT_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_prompt_versions_no_delete
BEFORE DELETE ON prompt_versions
BEGIN SELECT RAISE(ABORT, 'PROMPT_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_art_versions_no_update
BEFORE UPDATE ON art_versions
BEGIN SELECT RAISE(ABORT, 'ART_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_art_versions_no_delete
BEFORE DELETE ON art_versions
BEGIN SELECT RAISE(ABORT, 'ART_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_prompt_inputs_no_update
BEFORE UPDATE ON prompt_input_submissions
BEGIN SELECT RAISE(ABORT, 'PROMPT_INPUT_IMMUTABLE'); END;
CREATE TRIGGER trg_prompt_inputs_no_delete
BEFORE DELETE ON prompt_input_submissions
BEGIN SELECT RAISE(ABORT, 'PROMPT_INPUT_IMMUTABLE'); END;
CREATE TRIGGER trg_character_brief_versions_no_update
BEFORE UPDATE ON character_brief_versions
BEGIN SELECT RAISE(ABORT, 'CHARACTER_BRIEF_IMMUTABLE'); END;
CREATE TRIGGER trg_character_brief_versions_no_delete
BEFORE DELETE ON character_brief_versions
BEGIN SELECT RAISE(ABORT, 'CHARACTER_BRIEF_IMMUTABLE'); END;
CREATE TRIGGER trg_art_asset_links_no_update
BEFORE UPDATE ON asset_links
WHEN OLD.owner_type = 'art_version'
BEGIN SELECT RAISE(ABORT, 'ART_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_art_asset_links_no_delete
BEFORE DELETE ON asset_links
WHEN OLD.owner_type = 'art_version'
BEGIN SELECT RAISE(ABORT, 'ART_VERSION_IMMUTABLE'); END;

CREATE TRIGGER trg_prompt_drafts_refs_insert
AFTER INSERT ON prompt_drafts
BEGIN
  SELECT CASE WHEN NEW.base_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE id = NEW.base_version_id AND art_project_id = NEW.art_project_id
  ) THEN RAISE(ABORT, 'PROMPT_DRAFT_BASE_INVALID') END;
  SELECT CASE WHEN NEW.input_submission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM prompt_input_submissions WHERE id = NEW.input_submission_id AND art_project_id = NEW.art_project_id
  ) THEN RAISE(ABORT, 'PROMPT_DRAFT_INPUT_INVALID') END;
END;

CREATE TRIGGER trg_prompt_drafts_refs_update
AFTER UPDATE OF base_version_id, input_submission_id ON prompt_drafts
BEGIN
  SELECT CASE WHEN NEW.base_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE id = NEW.base_version_id AND art_project_id = NEW.art_project_id
  ) THEN RAISE(ABORT, 'PROMPT_DRAFT_BASE_INVALID') END;
  SELECT CASE WHEN NEW.input_submission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM prompt_input_submissions WHERE id = NEW.input_submission_id AND art_project_id = NEW.art_project_id
  ) THEN RAISE(ABORT, 'PROMPT_DRAFT_INPUT_INVALID') END;
END;

CREATE TRIGGER trg_prompt_versions_parent_same_project
BEFORE INSERT ON prompt_versions
WHEN NEW.parent_version_id IS NOT NULL
 AND (SELECT art_project_id FROM prompt_versions WHERE id = NEW.parent_version_id) <> NEW.art_project_id
BEGIN SELECT RAISE(ABORT, 'PROMPT_PARENT_PROJECT_MISMATCH'); END;

CREATE TRIGGER trg_art_versions_parent_same_project
BEFORE INSERT ON art_versions
WHEN NEW.parent_version_id IS NOT NULL
 AND (SELECT art_project_id FROM art_versions WHERE id = NEW.parent_version_id) <> NEW.art_project_id
BEGIN SELECT RAISE(ABORT, 'ART_PARENT_PROJECT_MISMATCH'); END;

CREATE TRIGGER trg_art_asset_links_primary_order
BEFORE INSERT ON asset_links
WHEN NEW.owner_type = 'art_version'
 AND ((NEW.is_primary = 1 AND NEW.sort_order <> 0)
   OR (NEW.is_primary = 0 AND NEW.sort_order = 0))
BEGIN SELECT RAISE(ABORT, 'ART_REFERENCE_ORDER_INVALID'); END;

CREATE TRIGGER trg_characters_active_brief_same_character
BEFORE UPDATE OF active_brief_version_id ON characters
WHEN NEW.active_brief_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM character_brief_versions
   WHERE id = NEW.active_brief_version_id AND character_id = NEW.id
 )
BEGIN SELECT RAISE(ABORT, 'ACTIVE_BRIEF_CHARACTER_MISMATCH'); END;

CREATE TRIGGER trg_prompt_input_brief_same_character
BEFORE INSERT ON prompt_input_submissions
WHEN NEW.character_brief_version_id IS NOT NULL
 AND (SELECT character_id FROM character_brief_versions WHERE id = NEW.character_brief_version_id)
   <> (SELECT character_id FROM art_projects WHERE id = NEW.art_project_id)
BEGIN SELECT RAISE(ABORT, 'PROMPT_INPUT_BRIEF_MISMATCH'); END;

CREATE TRIGGER trg_art_projects_active_art_same_project
BEFORE UPDATE OF active_version_id ON art_projects
WHEN NEW.active_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM art_versions WHERE id = NEW.active_version_id AND art_project_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'ACTIVE_ART_PROJECT_MISMATCH'); END;

CREATE TRIGGER trg_art_projects_active_prompt_same_project
BEFORE UPDATE OF active_prompt_version_id ON art_projects
WHEN NEW.active_prompt_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM prompt_versions WHERE id = NEW.active_prompt_version_id AND art_project_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'ACTIVE_PROMPT_PROJECT_MISMATCH'); END;

CREATE TRIGGER trg_generation_base_art_same_project
BEFORE INSERT ON generation_jobs
WHEN NEW.base_art_version_id IS NOT NULL
 AND (SELECT art_project_id FROM art_versions WHERE id = NEW.base_art_version_id) <> NEW.art_project_id
BEGIN SELECT RAISE(ABORT, 'GENERATION_BASE_PROJECT_MISMATCH'); END;

CREATE TRIGGER trg_candidate_accepted_version_same_generation
BEFORE UPDATE OF accepted_art_version_id ON generation_candidates
WHEN NEW.accepted_art_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM art_versions v
   JOIN generation_jobs g ON g.art_project_id = v.art_project_id
   WHERE v.id = NEW.accepted_art_version_id AND g.id = NEW.generation_job_id
 )
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_ART_PROJECT_MISMATCH'); END;
