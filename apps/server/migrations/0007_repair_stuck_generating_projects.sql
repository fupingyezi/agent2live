-- Projects that entered 'generating' before terminal rollback existed stayed
-- stuck there after their jobs failed. Restore the best stage the persisted
-- data supports, but never touch a project that still has an active job.
UPDATE art_projects
SET stage = CASE
    WHEN active_version_id IS NOT NULL THEN 'art_version_active'
    WHEN EXISTS (
      SELECT 1
      FROM generation_jobs gj
      JOIN generation_candidates gc ON gc.generation_job_id = gj.id
      WHERE gj.art_project_id = art_projects.id
    ) THEN 'candidate_review'
    WHEN active_prompt_version_id IS NOT NULL THEN 'prompt_ready'
    ELSE 'prompt_draft'
  END,
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  row_version = row_version + 1
WHERE stage = 'generating'
  AND NOT EXISTS (
    SELECT 1
    FROM generation_jobs gj
    JOIN jobs j ON j.id = gj.job_id
    WHERE gj.art_project_id = art_projects.id
      AND j.status IN ('queued', 'leased', 'running', 'waiting_user', 'retrying')
  );
