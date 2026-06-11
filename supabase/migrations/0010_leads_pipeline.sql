-- ============================================================
-- 0010_leads_pipeline.sql
-- ============================================================
-- Phase 1 P1-B (LOOP.md) — Leads & Bids pipeline (CRM-lite).
--
-- The front door of the app: every job starts as a lead and moves
-- through Ian's pipeline stages. Stage VALUES are snake_case wire
-- format; the UI renders Ian's exact stage names (Leads, Pending,
-- Estimating, Proposed, Signed, In-Progress, Completed, Lost) via
-- LEAD_STAGE_CONFIG in statusConfig.ts.
--
-- Architecture decisions locked at drift gate (Loop session 1):
--   1. leads is a NEW top-level table (owner-by-user_id RLS pattern,
--      same as customers). A lead is NOT a customer — it carries its
--      own contact fields until conversion creates the customer.
--   2. leads.stage stores the full pipeline stage (single source for
--      the board). The data layer auto-advances it on lifecycle
--      events (convert → estimating, proposal presented → proposed,
--      accepted → signed, completed → completed); manual moves are
--      allowed everywhere; declined proposals do NOT force Lost —
--      the UI confirms first (LOOP.md P1-B: "confirm, don't force").
--   3. project_id nullable, ON DELETE SET NULL — deleting a project
--      demotes the lead back to an unlinked card, never deletes it.
--   4. Timestamped notes are a child table (lead_notes), append-only
--      in the UI.
--   5. proposals.presented_at is additive — stamped by the data layer
--      the FIRST time a proposal transitions to 'presented'; powers
--      the "proposal sent" date-range filter on the list view.
--
-- Additive only. No existing table/column is altered or dropped
-- (RED LINE 4) except the new nullable proposals.presented_at column.

-- ============================================================
-- leads
-- ============================================================
CREATE TABLE public.leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- CRM-lite contact (a lead isn't a customer yet)
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  job_address    TEXT,
  town           TEXT,
  source         TEXT,

  stage          TEXT NOT NULL DEFAULT 'lead'
                 CHECK (stage IN (
                   'lead','pending','estimating','proposed',
                   'signed','in_progress','completed','lost'
                 )),
  follow_up_date DATE,

  -- Set at conversion; reaching proposals goes through the project.
  project_id     UUID REFERENCES public.projects(id) ON DELETE SET NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_leads_user_id        ON public.leads(user_id);
CREATE INDEX idx_leads_stage          ON public.leads(stage);
CREATE INDEX idx_leads_follow_up_date ON public.leads(follow_up_date);
CREATE INDEX idx_leads_project_id     ON public.leads(project_id);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select_own" ON public.leads FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "leads_insert_own" ON public.leads FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "leads_update_own" ON public.leads FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "leads_delete_own" ON public.leads FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- lead_notes — timestamped, append-only notes per lead
-- ============================================================
CREATE TABLE public.lead_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_notes_lead_id ON public.lead_notes(lead_id);

ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;

-- RLS via parent lead ownership (same pattern as work_areas → projects).
CREATE POLICY "lead_notes_select_own" ON public.lead_notes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_notes.lead_id AND l.user_id = auth.uid()));
CREATE POLICY "lead_notes_insert_own" ON public.lead_notes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_notes.lead_id AND l.user_id = auth.uid()));
CREATE POLICY "lead_notes_update_own" ON public.lead_notes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_notes.lead_id AND l.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_notes.lead_id AND l.user_id = auth.uid()));
CREATE POLICY "lead_notes_delete_own" ON public.lead_notes FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_notes.lead_id AND l.user_id = auth.uid()));

-- ============================================================
-- proposals.presented_at — first-presentation timestamp
-- ============================================================
ALTER TABLE public.proposals ADD COLUMN presented_at TIMESTAMPTZ;
