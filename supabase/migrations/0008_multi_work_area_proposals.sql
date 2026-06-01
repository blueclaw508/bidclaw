-- ============================================================
-- 0008_multi_work_area_proposals.sql
-- ============================================================
-- Phase 2 Prompt 6 REVISED — multi-work-area-per-proposal architecture.
--
-- BACKGROUND
-- Phase 1 (0007) modeled proposals as 1:1 with a single work area
-- (proposals.work_area_id NOT NULL). After scope conversation with
-- QC reference repo readout, Path 2 + multi-work-area-per-proposal
-- locked: a proposal now spans multiple work areas (mix of project-
-- linked + ad-hoc / change-order), each rendered as its own card in
-- the QC-style editor.
--
-- This migration adds the proposal_work_areas join table, rewires
-- proposal_lines to attribute to a (proposal, work_area) pair, and
-- drops the obsolete proposals.work_area_id direct FK.
--
-- DATA SAFETY
-- Pre-flight verified both proposals + proposal_lines are empty.
-- The DELETE statements below are therefore no-ops in production.
-- If this migration is ever replayed against a DB with rows, the
-- DELETEs WILL destroy them — pre-flight check is mandatory.
--
-- ARCHITECTURE DECISIONS LOCKED FROM SCOPE
--   • work_area_id on proposal_work_areas is NULLABLE — supports
--     ad-hoc work areas (change orders, allowances) with no source
--     project work area
--   • Unique constraint on (proposal_id, work_area_id) only WHERE
--     work_area_id IS NOT NULL — multiple ad-hoc rows per proposal
--     are allowed
--   • work_areas → proposal_work_areas = ON DELETE RESTRICT — prevent
--     accidental data loss when a project's work area is deleted
--     while still referenced by an in-flight proposal
--   • proposals → proposal_work_areas = ON DELETE CASCADE
--   • proposal_work_areas → proposal_lines = ON DELETE CASCADE
--   • Denormalized per-work-area subtotals (labor/material/equipment/
--     subcontractor/other) stored on proposal_work_areas — fast list
--     + grand-total reads; must be re-synced from proposal_lines
--     after every line CUD via syncProposalWorkAreaSubtotals() in
--     the data layer

-- ============================================================
-- Step 1 — proposal_work_areas join table
-- ============================================================
CREATE TABLE public.proposal_work_areas (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id              UUID NOT NULL REFERENCES public.proposals(id)   ON DELETE CASCADE,
  -- NULLABLE — ad-hoc work areas have no source project work area
  work_area_id             UUID          REFERENCES public.work_areas(id) ON DELETE RESTRICT,

  position                 INTEGER NOT NULL DEFAULT 0,
  name_override            TEXT,
  description_override     TEXT,
  enabled                  BOOLEAN NOT NULL DEFAULT true,

  -- Denormalized 5-category subtotals — see syncProposalWorkAreaSubtotals
  labor_subtotal           NUMERIC NOT NULL DEFAULT 0 CHECK (labor_subtotal         >= 0),
  material_subtotal        NUMERIC NOT NULL DEFAULT 0 CHECK (material_subtotal      >= 0),
  equipment_subtotal       NUMERIC NOT NULL DEFAULT 0 CHECK (equipment_subtotal     >= 0),
  subcontractor_subtotal   NUMERIC NOT NULL DEFAULT 0 CHECK (subcontractor_subtotal >= 0),
  other_subtotal           NUMERIC NOT NULL DEFAULT 0 CHECK (other_subtotal         >= 0),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate (proposal, project-work-area) memberships, but
-- allow multiple ad-hoc rows per proposal (NULL work_area_id repeats OK).
CREATE UNIQUE INDEX idx_proposal_work_areas_unique_link
  ON public.proposal_work_areas (proposal_id, work_area_id)
  WHERE work_area_id IS NOT NULL;

CREATE INDEX idx_proposal_work_areas_proposal  ON public.proposal_work_areas(proposal_id);
CREATE INDEX idx_proposal_work_areas_work_area ON public.proposal_work_areas(work_area_id);
CREATE INDEX idx_proposal_work_areas_position  ON public.proposal_work_areas(proposal_id, position);

ALTER TABLE public.proposal_work_areas ENABLE ROW LEVEL SECURITY;

-- RLS via parent proposal → project → user_id (same pattern as
-- proposal_lines in 0007).
CREATE POLICY "proposal_work_areas_select_own" ON public.proposal_work_areas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_work_areas.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_work_areas_insert_own" ON public.proposal_work_areas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_work_areas.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_work_areas_update_own" ON public.proposal_work_areas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_work_areas.proposal_id AND pr.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_work_areas.proposal_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "proposal_work_areas_delete_own" ON public.proposal_work_areas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = proposal_work_areas.proposal_id AND pr.user_id = auth.uid()
    )
  );

CREATE TRIGGER proposal_work_areas_set_updated_at
  BEFORE UPDATE ON public.proposal_work_areas
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- Step 2 — proposal_lines.proposal_work_area_id + cleanup
-- ============================================================
-- Add the new FK column NULLABLE first so the ALTER doesn't reject
-- the empty table for missing values.
ALTER TABLE public.proposal_lines
  ADD COLUMN proposal_work_area_id UUID
  REFERENCES public.proposal_work_areas(id) ON DELETE CASCADE;

-- Clear any smoke-test rows that pre-flight may have missed (no-op
-- when table is empty, which pre-flight confirmed).
DELETE FROM public.proposal_lines;
DELETE FROM public.proposals;

-- Now lock the new FK as NOT NULL — every line attributes to a
-- (proposal, work_area) pair.
ALTER TABLE public.proposal_lines
  ALTER COLUMN proposal_work_area_id SET NOT NULL;

CREATE INDEX idx_proposal_lines_work_area ON public.proposal_lines(proposal_work_area_id);

-- ============================================================
-- Step 3 — drop the obsolete proposals.work_area_id direct FK
-- ============================================================
-- Proposals are now project-level; work area membership lives in
-- proposal_work_areas (1:N).
ALTER TABLE public.proposals DROP COLUMN work_area_id;
