-- ============================================================
-- 0013 — Estimate-first rework, R1 (QC fidelity)
-- Applied to prod via Supabase MCP on 2026-06-11 as:
--   estimate_first_work_area_lines_address_split
--
-- Work areas become the estimate container. Lines here are LIVE
-- working numbers (QC model): base cost stored, markup applied
-- from current settings at render, optional price override.
-- Freezing happens later, at proposal GENERATION (R4), into the
-- existing proposal_lines tables.
--
-- Decisions (Ian, 2026-06-11): per-WA estimate approval gates
-- generation, proposal keeps its own lifecycle after; instant-save
-- editing semantics; client share/approve loop deferred.
-- Audit: docs/analysis/QC-FIDELITY-AUDIT-2026-06-11.md
-- ============================================================

-- 1. work_area_lines — the estimate lines
CREATE TABLE public.work_area_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_area_id    uuid NOT NULL REFERENCES public.work_areas(id) ON DELETE CASCADE,
  category        text NOT NULL CHECK (category IN ('labor','material','equipment','subcontractor','other')),
  label           text NOT NULL,
  unit            text NOT NULL DEFAULT '',
  -- Working numbers: qty 0 is legal while drafting (unlike frozen
  -- proposal_lines which require > 0)
  quantity        numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- BASE cost per unit (pre-markup). Billed price is computed live:
  -- material/sub/other -> unit_cost * (1 + current settings markup/100)
  -- labor/equipment    -> unit_cost (rate; markup pre-baked per KYN)
  unit_cost       numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  -- QC's isAmountOverridden + amount: when non-null, this line's total
  -- is exactly this value (amber-flagged in UI); when null, computed.
  price_override  numeric NULL CHECK (price_override >= 0),
  -- Traceability (the column proposal_lines never got)
  catalog_item_id uuid NULL REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  source_kit_id   uuid NULL REFERENCES public.kits(id) ON DELETE SET NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_area_lines_work_area_id ON public.work_area_lines(work_area_id);
CREATE INDEX idx_work_area_lines_catalog_item_id ON public.work_area_lines(catalog_item_id);

CREATE TRIGGER work_area_lines_set_updated_at
  BEFORE UPDATE ON public.work_area_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS: two-hop scope through work_areas -> projects.user_id,
-- mirroring the existing work_areas policy shape.
ALTER TABLE public.work_area_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_area_lines_select_own ON public.work_area_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.work_areas wa
    JOIN public.projects p ON p.id = wa.project_id
    WHERE wa.id = work_area_lines.work_area_id AND p.user_id = auth.uid()));

CREATE POLICY work_area_lines_insert_own ON public.work_area_lines
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.work_areas wa
    JOIN public.projects p ON p.id = wa.project_id
    WHERE wa.id = work_area_lines.work_area_id AND p.user_id = auth.uid()));

CREATE POLICY work_area_lines_update_own ON public.work_area_lines
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.work_areas wa
    JOIN public.projects p ON p.id = wa.project_id
    WHERE wa.id = work_area_lines.work_area_id AND p.user_id = auth.uid()));

CREATE POLICY work_area_lines_delete_own ON public.work_area_lines
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.work_areas wa
    JOIN public.projects p ON p.id = wa.project_id
    WHERE wa.id = work_area_lines.work_area_id AND p.user_id = auth.uid()));

-- 2. Per-WA estimate lifecycle (Ian's decision: per-WA approve gates
--    proposal generation; the proposal keeps its own lifecycle after).
--    The legacy generic work_areas.status column stays dormant; its
--    UI picker is removed in R3.
ALTER TABLE public.work_areas
  ADD COLUMN estimate_status text NOT NULL DEFAULT 'drafting'
  CHECK (estimate_status IN ('drafting','approved'));

-- 3. Customers address split (QC fidelity: Line1/City/State/Zip).
--    Existing freeform billing_address / site_address stay dormant so
--    no dogfood data is lost; R5 switches the UI to these fields.
ALTER TABLE public.customers
  ADD COLUMN billing_address_line1 text,
  ADD COLUMN billing_address_city  text,
  ADD COLUMN billing_address_state text,
  ADD COLUMN billing_address_zip   text,
  ADD COLUMN site_address_line1    text,
  ADD COLUMN site_address_city     text,
  ADD COLUMN site_address_state    text,
  ADD COLUMN site_address_zip      text;

-- 4. Projects job-address split (same shape; saves a later migration —
--    QC's job address is the split one on the estimate/project).
ALTER TABLE public.projects
  ADD COLUMN site_address_line1 text,
  ADD COLUMN site_address_city  text,
  ADD COLUMN site_address_state text,
  ADD COLUMN site_address_zip   text;
