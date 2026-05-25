-- ============================================================
-- 0005_address_split_and_qc_visual_alignment.sql
-- ============================================================
-- Second Phase 2 scope correction. After reading QC source
-- (blueclaw508/quickcalc src/components/quickcalc/EnterMyNumbers.tsx)
-- this migration aligns BidClaw exactly to QC's data model PLUS
-- the QBO-compatibility address split Ian directed.
--
-- Changes:
--   1. Address split — drop the single-field company_address, add
--      5 normalized fields (Line 1 + Line 2 + City + State + ZIP).
--      Country defaults to US, not stored.
--   2. PDF visibility toggles — QC has 3 (Payment Terms, Images,
--      Terms & Conditions), NOT the 5 contact-info toggles I had.
--   3. Drop markup_freight_percent — QC has only Materials + Subs.
--      Ian's earlier directive included Freight, but the new
--      directive ("match real implementation, not screenshot
--      description") overrides — follow QC source.

-- ── 1. Address split ──────────────────────────────────────────
ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS company_address;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS company_address_line1  TEXT,
  ADD COLUMN IF NOT EXISTS company_address_line2  TEXT,
  ADD COLUMN IF NOT EXISTS company_address_city   TEXT,
  ADD COLUMN IF NOT EXISTS company_address_state  TEXT,  -- 2-letter postal code
  ADD COLUMN IF NOT EXISTS company_address_zip    TEXT;

-- ── 2. PDF visibility toggles realignment ─────────────────────
ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS pdf_show_logo,
  DROP COLUMN IF EXISTS pdf_show_email,
  DROP COLUMN IF EXISTS pdf_show_phone,
  DROP COLUMN IF EXISTS pdf_show_address,
  DROP COLUMN IF EXISTS pdf_show_website;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS pdf_show_payment_terms          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_images                 BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_terms_and_conditions   BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 3. Drop freight markup ────────────────────────────────────
ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS markup_freight_percent;
