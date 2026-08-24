-- 0025 — let Jamie read the project's file repository (J4).
--
-- Until now Jamie could only see photos uploaded through her own panel
-- (the `jamie-images` bucket). Everything the contractor actually put on
-- the project — plan sheets, bid forms, surveys — lived in `project_files`
-- and was invisible to her. There is ONE file repository per project, and
-- this is it.
--
-- Each file is uploaded to the Anthropic Files API once and referenced by
-- id from then on, instead of re-sending megabytes of plan PDFs on every
-- turn. `anthropic_file_id` is that handle; NULL means "not synced yet".
-- `anthropic_sync_error` records why a file could not be synced (wrong
-- type, too large, upload failed) so the UI can say so instead of the
-- file silently never reaching her.

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS anthropic_file_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS anthropic_synced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS anthropic_sync_error TEXT NULL;

-- The sync pass looks up "files on this project that Jamie hasn't got yet",
-- which is a partial scan over unsynced rows only.
CREATE INDEX IF NOT EXISTS idx_project_files_unsynced
  ON public.project_files (project_id)
  WHERE anthropic_file_id IS NULL;
