-- Upstream failure metadata (HTTP status and sanitized provider error code).
-- Response bodies are deliberately never persisted.
ALTER TABLE provider_invocations ADD COLUMN error_detail_json TEXT;

-- Stage the project was in before this generation set it to 'generating', so a
-- failed, cancelled, or unknown-outcome job can restore a truthful stage.
ALTER TABLE generation_jobs ADD COLUMN stage_before TEXT;
