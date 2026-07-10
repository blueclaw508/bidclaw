-- 0023 — J1: jamie-images private bucket + legacy metering seam
--
-- 1) jamie-images: PRIVATE storage bucket for Jamie chat photo uploads
--    (J1 Part A / J2 UI). Owner-folder RLS, same pattern as project-files
--    and company-assets: path must start with the uploader's auth.uid().
--    The Edge Function reads refs server-side (service role) and base64s
--    them into the Anthropic call — raw base64 never lands in the DB.
--
-- 2) jamie_invocations.jamie_run_id → NULLABLE. J1 Part C meters the
--    LEGACY Phase-1 jamie-estimate function (recording only), and those
--    single-shot calls have no jamie_loop_runs row — legacy rows carry
--    NULL. Loop rows keep setting it; quota counting is unaffected
--    (legacy rows are counts_against_quota = FALSE, founder-mode).

INSERT INTO storage.buckets (id, name, public)
VALUES ('jamie-images', 'jamie-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY jamie_images_bucket_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'jamie-images'
         AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY jamie_images_bucket_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'jamie-images'
              AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY jamie_images_bucket_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'jamie-images'
         AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY jamie_images_bucket_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'jamie-images'
         AND (auth.uid())::text = (storage.foldername(name))[1]);

ALTER TABLE jamie_invocations ALTER COLUMN jamie_run_id DROP NOT NULL;

COMMENT ON COLUMN jamie_invocations.jamie_run_id IS
  'NULL for legacy Phase-1 jamie-estimate invocations (single-shot, no loop run). Loop invocations always set it.';
