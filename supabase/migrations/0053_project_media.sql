ALTER TABLE public.project_files DROP CONSTRAINT project_files_file_type_check;
ALTER TABLE public.project_files ADD CONSTRAINT project_files_file_type_check CHECK (file_type IN ('original_plan','measured_plan','crew_budget','customer_proposal','signed_proposal','invoice','change_order','other','photo','video'));
ALTER TABLE public.project_files
  ADD COLUMN media_status text CHECK (media_status IN ('processing','ready','error')),
  ADD COLUMN media_notes text,
  ADD COLUMN media_error text,
  ADD COLUMN media_started_at timestamptz,
  ADD COLUMN media_provider_file text;
-- Original assets stay private under the existing owner-folder policies.
UPDATE storage.buckets SET file_size_limit = 262144000 WHERE id = 'project-files';
