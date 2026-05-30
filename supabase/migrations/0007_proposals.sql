-- ============================================================
-- 0007_proposals.sql
-- ============================================================
-- Phase 2 Prompt 6 — Manual proposal creation.
--
-- A proposal is what gets generated when a contractor picks a kit
-- and an input quantity for an approved work area. Kit factors ×
-- input qty → resolved proposal_lines; pricing snapshot (rates +
-- markup) is FROZEN at insert time so future edits to settings or
-- catalog don't retroactively change the proposal (Q3a).
--
-- Architecture decisions locked at the start of Prompt 6:
--
--   1. Hand-rolled types in src/lib/types.ts (matches Prompts 1–5).
--   2. proposal_lines.category extends to 5 values including 'other'.
--      'Other' lines (from kit_line.type='Other') use markup_subs_percent
--      until a dedicated markup_other_percent is introduced.
--   3. reference_missing kit lines block preview entirely.
--   4. NULL-factor / factor=0 placeholder lines surface as
--      placeholder: true in preview; quantity=0 commits are silently
--      filtered at insert.
--   5. frozen_unit_cost is canonical for all calculation.
--      frozen_labor_rate + frozen_equipment_rate are pure audit fields.

-- ============================================================
-- proposals — one row per "kit application" against a work area
-- ============================================================
CREATE TABLE public.proposals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT on work_area_id — deleting a work area that has
  -- proposals would orphan the pricing snapshot; force the contractor
  -- to delete the proposals first.
  work_area_id  UUID NOT NULL REFERENCES public.work_areas(id) ON DELETE RESTRICT,

  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'presented', 'accepted', 'declined', 'completed')),
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_proposals_project   ON public.proposals(project_id);
CREATE INDEX idx_proposals_work_area ON public.proposals(work_area_id);
CREATE INDEX idx_proposals_status    ON public.proposals(status);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- RLS via parent project ownership. proposals have no user_id of their
-- own; projects.user_id is the trust boundary (matches the kit_lines
-- pattern from Prompt 5).
CREATE POLICY "proposals_select_own" ON public.proposals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = proposals.project_id AND p.user_id = auth.uid()
    )
  );
CREATE POLICY "proposals_insert_own" ON public.proposals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = proposals.project_id AND p.user_id = auth.uid()
    )
  );
CREATE POLICY "proposals_update_own" ON public.proposals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = proposals.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = proposals.project_id AND p.user_id = auth.uid()
    )
  );
CREATE POLICY "proposals_delete_own" ON public.proposals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = proposals.project_id AND p.user_id = auth.uid()
    )
  );

CREATE TRIGGER proposals_set_updated_at BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- proposal_lines — line items with frozen pricing snapshot
-- ============================================================
CREATE TABLE public.proposal_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id                 UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,

  -- Traceability to the source kit + line. Both nullable so custom
  -- lines (added without a kit source) are first-class. ON DELETE
  -- SET NULL so deleting a kit later doesn't nuke a proposal that
  -- referenced it — the snapshot already has everything we need.
  source_kit_id               UUID REFERENCES public.kits(id) ON DELETE SET NULL,
  source_kit_line_id          UUID REFERENCES public.kit_lines(id) ON DELETE SET NULL,

  -- Five categories. Adds 'other' to the four categories named in
  -- the Phase 1 spec so kit_line.type='Other' has a home (decision 2).
  category                    TEXT NOT NULL
                                CHECK (category IN (
                                  'material',
                                  'labor',
                                  'equipment',
                                  'subcontractor',
                                  'other'
                                )),

  label                       TEXT NOT NULL,
  unit                        TEXT NOT NULL,
  quantity                    NUMERIC NOT NULL CHECK (quantity > 0),

  -- frozen_unit_cost is canonical (decision 5). Labor/equipment lines
  -- copy the rate INTO frozen_unit_cost at insert. Calculation always
  -- reads frozen_unit_cost.
  frozen_unit_cost            NUMERIC NOT NULL CHECK (frozen_unit_cost >= 0),

  -- Audit-only snapshots (decision 5). NULL for non-labor / non-equipment
  -- lines and for custom lines where the contractor entered the cost
  -- directly without a rate-table source.
  frozen_labor_rate           NUMERIC,
  frozen_equipment_rate       NUMERIC,

  -- Markup snapshot — applied at calc time. 0 for labor/equipment per
  -- BCA convention; markup_materials_percent for materials;
  -- markup_subs_percent for subcontractor + other.
  frozen_markup_percent       NUMERIC NOT NULL CHECK (frozen_markup_percent >= 0),

  -- Audit-only kit factor snapshot. NULL for custom lines.
  frozen_kit_factor           NUMERIC,
  -- Audit-only snapshot of the upstream entity's label (catalog item
  -- name / labor type name / equipment rate name), so renaming the
  -- source after the fact doesn't lose the original context.
  frozen_reference_label      TEXT,

  sort_order                  INTEGER NOT NULL DEFAULT 0,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_proposal_lines_proposal     ON public.proposal_lines(proposal_id);
CREATE INDEX idx_proposal_lines_source_kit   ON public.proposal_lines(source_kit_id);

ALTER TABLE public.proposal_lines ENABLE ROW LEVEL SECURITY;

-- RLS through parent proposal ownership (which in turn goes through
-- the project's user_id). Same pattern as kit_lines from Prompt 5.
CREATE POLICY "proposal_lines_select_own" ON public.proposal_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_lines.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_lines_insert_own" ON public.proposal_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_lines.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_lines_update_own" ON public.proposal_lines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_lines.proposal_id AND pr.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_lines.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_lines_delete_own" ON public.proposal_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_lines.proposal_id AND pr.user_id = auth.uid()
    )
  );

CREATE TRIGGER proposal_lines_set_updated_at BEFORE UPDATE ON public.proposal_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
