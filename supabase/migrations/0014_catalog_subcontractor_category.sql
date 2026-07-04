-- 0014 — Add 'subcontractor' as a first-class catalog category (R3.1).
-- Applied to prod via Supabase MCP on 2026-07-04.
-- The audit flagged the hardcoded disposal/design→subcontractor bucket
-- as debt; on-the-fly custom items (QC parity: custom estimate items
-- save to the catalog) need the real category.
ALTER TABLE public.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_category_check;
ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_category_check
  CHECK (category IN ('labor','material','equipment','subcontractor','disposal','design','other'));
