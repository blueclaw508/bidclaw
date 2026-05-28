-- ============================================================
-- 0006_kit_library.sql
-- ============================================================
-- Phase 2 Prompt 5 — Kit Library.
--
-- Kits are calculation recipes for a single work type (e.g.,
-- "Drylaid Bluestone Patio Standard"). A kit's lines define quantity
-- formulas — each line has a factor (e.g., 0.22 Hr/SF) that gets
-- multiplied by an input quantity (e.g., 1000 SF) to generate
-- proposal line items. Kits do NOT contain prices. Pricing happens
-- downstream when proposals consume kits (Prompts 6-8).
--
-- Architecture decisions:
--
--   • Per-user — kits are strictly owned. No marketplace/sharing in
--     Phase 2. RLS via user_id on `kits`, indirect ownership on
--     `kit_lines` through parent kit.
--
--   • Polymorphic-ish references — each kit_line can point to ONE of
--     three upstream entities depending on its type:
--       Labor    → company_labor_types.id
--       Equipment → company_equipment_rates.id
--       Material  → catalog_items.id
--       Sub / Other → no reference (free-form placeholder)
--     A reference_type enum + three nullable FK columns keeps queries
--     explicit and FK constraints intact. (A single polymorphic UUID
--     column would lose FK integrity.)
--
--   • Cascade on delete — if a referenced labor type / equipment rate
--     / catalog item is deleted, the kit_line stays but the FK is set
--     to NULL. The UI surfaces "Reference deleted — please re-select"
--     so the contractor can repair the line. We don't want a deleted
--     catalog item to nuke a 20-line kit.
--
--   • Factors stay constant on the kit. Pricing rates live in
--     Settings + catalog and are frozen at proposal creation time
--     (Q3a). Editing a kit factor changes future proposals only.

-- ============================================================
-- Enums — kit line types + reference types
-- ============================================================
CREATE TYPE public.kit_line_type AS ENUM (
  'Labor',
  'Material',
  'Equipment',
  'Sub',
  'Other'
);

CREATE TYPE public.kit_line_reference_type AS ENUM (
  'labor_type',
  'equipment_rate',
  'catalog_item',
  'none'
);

-- ============================================================
-- kits — header row, one per recipe
-- ============================================================
CREATE TABLE public.kits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  input_unit     TEXT NOT NULL,
  branch_scope   TEXT,
  jamie_notes    TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'archived')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kits_user_id ON public.kits(user_id);
-- Partial index for the default Active view — most reads filter to
-- active kits; archived live behind a toggle.
CREATE INDEX idx_kits_user_active ON public.kits(user_id, updated_at DESC)
  WHERE status = 'active';

ALTER TABLE public.kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kits_select_own" ON public.kits FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "kits_insert_own" ON public.kits FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "kits_update_own" ON public.kits FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "kits_delete_own" ON public.kits FOR DELETE
  USING (user_id = auth.uid());

CREATE TRIGGER kits_set_updated_at BEFORE UPDATE ON public.kits
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- kit_lines — one row per line item inside a kit
-- ============================================================
-- Polymorphic reference: reference_type tells the app which of the
-- three FK columns to read. Exactly ZERO or ONE of the FKs should
-- be non-NULL — enforced by the CHECK constraint below.
CREATE TABLE public.kit_lines (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id                          UUID NOT NULL REFERENCES public.kits(id) ON DELETE CASCADE,

  position                        INTEGER NOT NULL DEFAULT 0,
  type                            public.kit_line_type NOT NULL,
  display_name                    TEXT NOT NULL,

  -- Polymorphic reference (exactly one FK populated, the rest NULL).
  reference_type                  public.kit_line_reference_type NOT NULL DEFAULT 'none',
  reference_labor_type_id         UUID REFERENCES public.company_labor_types(id) ON DELETE SET NULL,
  reference_equipment_rate_id     UUID REFERENCES public.company_equipment_rates(id) ON DELETE SET NULL,
  reference_catalog_item_id       UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,

  -- Factor + unit. NULL factor allowed for placeholder lines.
  factor                          NUMERIC(12, 6),
  factor_unit                     TEXT,

  notes                           TEXT,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Reference integrity: at most one FK populated, and the
  -- reference_type must match which column is populated (or 'none'
  -- when no FK is set, including after a cascade SET NULL).
  CONSTRAINT kit_lines_reference_consistency CHECK (
    -- Count of non-NULL reference FKs must be 0 or 1
    (
      (reference_labor_type_id     IS NOT NULL)::int +
      (reference_equipment_rate_id IS NOT NULL)::int +
      (reference_catalog_item_id   IS NOT NULL)::int
    ) <= 1
    AND
    -- If reference_type names a kind, the matching FK may be populated
    -- (or NULL after a cascade SET NULL — both are valid). If
    -- reference_type='none', no FK should be populated.
    CASE reference_type
      WHEN 'none'           THEN reference_labor_type_id IS NULL
                                AND reference_equipment_rate_id IS NULL
                                AND reference_catalog_item_id IS NULL
      WHEN 'labor_type'     THEN reference_equipment_rate_id IS NULL
                                AND reference_catalog_item_id IS NULL
      WHEN 'equipment_rate' THEN reference_labor_type_id IS NULL
                                AND reference_catalog_item_id IS NULL
      WHEN 'catalog_item'   THEN reference_labor_type_id IS NULL
                                AND reference_equipment_rate_id IS NULL
    END
  ),

  -- Factor non-negative when set. NULL factors are placeholders.
  CONSTRAINT kit_lines_factor_non_negative CHECK (
    factor IS NULL OR factor >= 0
  )
);

CREATE INDEX idx_kit_lines_kit_id ON public.kit_lines(kit_id);
CREATE INDEX idx_kit_lines_kit_position ON public.kit_lines(kit_id, position);

ALTER TABLE public.kit_lines ENABLE ROW LEVEL SECURITY;

-- RLS through kit ownership — kit_lines have no user_id of their own;
-- the kit row is the trust boundary.
CREATE POLICY "kit_lines_select_own" ON public.kit_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_lines.kit_id AND k.user_id = auth.uid()
    )
  );
CREATE POLICY "kit_lines_insert_own" ON public.kit_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_lines.kit_id AND k.user_id = auth.uid()
    )
  );
CREATE POLICY "kit_lines_update_own" ON public.kit_lines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_lines.kit_id AND k.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_lines.kit_id AND k.user_id = auth.uid()
    )
  );
CREATE POLICY "kit_lines_delete_own" ON public.kit_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_lines.kit_id AND k.user_id = auth.uid()
    )
  );

CREATE TRIGGER kit_lines_set_updated_at BEFORE UPDATE ON public.kit_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
