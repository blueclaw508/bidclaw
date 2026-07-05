-- 0016 — per-line markup override on estimate lines (reconcile).
-- The column was applied to prod live during dogfooding (loop session,
-- commit 3b3410f) but its migration file was never written — this file
-- reconciles the repo with the DB so a fresh rebuild matches prod.
-- NULL = use the company live markup for the category; a number = this
-- line's markup % (QC-style per-line override, mirrors price_override).
ALTER TABLE public.work_area_lines
  ADD COLUMN IF NOT EXISTS markup_override numeric NULL CHECK (markup_override >= 0);
