-- ============================================================================
-- 0001_phase1_foundation.sql
-- ============================================================================
-- Snapshot of the live cdjpzvyqvohwmlmquldt schema as of 2026-05-14.
-- Concatenation of two MCP-applied migrations:
--   - 20260514001023_phase1_foundation       (tables, indexes, updated_at fn)
--   - 20260514001116_phase1_rls_auth_storage (RLS, triggers, storage bucket)
--
-- The prior `phase1_wipe_legacy` migration (which dropped the previous
-- bidclaw_*/estimates/work_areas/measurements/production_rates tables)
-- is intentionally NOT included here — this file is a clean recovery
-- artifact, not a faithful event log. A fresh empty Supabase project
-- can be brought to the current state by applying just this one file.
--
-- DO NOT apply this against cdjpzvyqvohwmlmquldt as-is; it will fail
-- because the tables and policies already exist there. It exists in
-- the repo as an audit + disaster-recovery artifact. The live schema
-- continues to be managed via the Supabase MCP migrations stream.
-- ============================================================================


-- ============================================================
-- PHASE 1 FOUNDATION — BidClaw
-- Project-centric data model. Schema per Phase 1 Prompt 1 §6.
-- ============================================================

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLE: profiles (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT NOT NULL UNIQUE,
  full_name         TEXT,
  company_name      TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free'
                    CHECK (subscription_tier IN ('free','pro','ai_pro')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- TABLE: customers
-- ============================================================
CREATE TABLE public.customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  billing_address TEXT,
  site_address    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_customers_user_id ON public.customers(user_id);

-- ============================================================
-- TABLE: projects
-- ============================================================
CREATE TABLE public.projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id  UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','estimating','proposed','approved','in_progress','complete','lost','archived')),
  site_address TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_projects_user_id     ON public.projects(user_id);
CREATE INDEX idx_projects_customer_id ON public.projects(customer_id);
CREATE INDEX idx_projects_status      ON public.projects(status);

-- ============================================================
-- TABLE: work_areas
-- ============================================================
CREATE TABLE public.work_areas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','approved','in_progress','complete')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER work_areas_set_updated_at BEFORE UPDATE ON public.work_areas
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_work_areas_project_id ON public.work_areas(project_id);
CREATE INDEX idx_work_areas_status     ON public.work_areas(status);

-- ============================================================
-- TABLE: catalog_items
-- ============================================================
CREATE TABLE public.catalog_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  unit            TEXT NOT NULL,
  category        TEXT NOT NULL
                  CHECK (category IN ('labor','material','equipment','disposal','design','other')),
  unit_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
  markup_percent  NUMERIC(6,2)  NOT NULL DEFAULT 0,
  needs_pricing   BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER catalog_items_set_updated_at BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_catalog_items_user_id ON public.catalog_items(user_id);

-- ============================================================
-- TABLE: proposals
-- ============================================================
CREATE TABLE public.proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','approved','rejected','expired')),
  total_amount   NUMERIC(12,2),
  proposal_text  TEXT,
  sent_at        TIMESTAMPTZ,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER proposals_set_updated_at BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_proposals_project_id ON public.proposals(project_id);
CREATE INDEX idx_proposals_status     ON public.proposals(status);

-- ============================================================
-- TABLE: proposal_line_items
-- ============================================================
CREATE TABLE public.proposal_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  work_area_id    UUID REFERENCES public.work_areas(id) ON DELETE SET NULL,
  catalog_item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  description     TEXT NOT NULL,
  quantity        NUMERIC(12,4) NOT NULL,
  unit            TEXT NOT NULL,
  unit_cost       NUMERIC(12,4) NOT NULL,
  markup_percent  NUMERIC(6,2)  NOT NULL,
  line_total      NUMERIC(12,2) NOT NULL,
  category        TEXT NOT NULL
                  CHECK (category IN ('labor','material','equipment','disposal','design','other')),
  sequence_order  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proposal_line_items_proposal_id     ON public.proposal_line_items(proposal_id);
CREATE INDEX idx_proposal_line_items_work_area_id    ON public.proposal_line_items(work_area_id);
CREATE INDEX idx_proposal_line_items_catalog_item_id ON public.proposal_line_items(catalog_item_id);

-- ============================================================
-- TABLE: project_files (declared BEFORE measurements for FK)
-- ============================================================
CREATE TABLE public.project_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_type       TEXT NOT NULL
                  CHECK (file_type IN ('original_plan','measured_plan','crew_budget','customer_proposal','signed_proposal','invoice','change_order','other')),
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  mime_type       TEXT,
  file_size_bytes BIGINT,
  version_number  INTEGER NOT NULL DEFAULT 1,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_files_project_id ON public.project_files(project_id);
CREATE INDEX idx_project_files_file_type  ON public.project_files(file_type);

-- ============================================================
-- TABLE: measurements
-- ============================================================
CREATE TABLE public.measurements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_area_id     UUID REFERENCES public.work_areas(id) ON DELETE SET NULL,
  tool_type        TEXT NOT NULL
                   CHECK (tool_type IN ('line','area','count','freehand_polyline','freehand_drag')),
  label            TEXT,
  points           JSONB NOT NULL,
  pdf_page_number  INTEGER NOT NULL DEFAULT 1,
  source_file_id   UUID REFERENCES public.project_files(id) ON DELETE SET NULL,
  calculated_value NUMERIC(12,4),
  calculated_unit  TEXT,
  scale_factor     NUMERIC(12,6) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER measurements_set_updated_at BEFORE UPDATE ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_measurements_project_id     ON public.measurements(project_id);
CREATE INDEX idx_measurements_work_area_id   ON public.measurements(work_area_id);
CREATE INDEX idx_measurements_source_file_id ON public.measurements(source_file_id);

-- ============================================================
-- TABLE: qbo_account_mappings (stub for Phase 3)
-- ============================================================
CREATE TABLE public.qbo_account_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_category    TEXT NOT NULL
                   CHECK (item_category IN ('labor','material','equipment','disposal','design','other','wip_offset')),
  qbo_account_id   TEXT,
  qbo_account_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_category)
);
CREATE TRIGGER qbo_account_mappings_set_updated_at BEFORE UPDATE ON public.qbo_account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_qbo_account_mappings_user_id ON public.qbo_account_mappings(user_id);


-- ============================================================
-- PHASE 1 RLS, AUTH LOCKDOWN, AND STORAGE BUCKET
-- ============================================================

-- ── Enable RLS on every public table ──
ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_areas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_account_mappings ENABLE ROW LEVEL SECURITY;

-- ── profiles: row id IS the user id ──
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_delete_own" ON public.profiles FOR DELETE USING (id = auth.uid());

-- ── Owner-by-user_id tables (direct ownership) ──
CREATE POLICY "customers_select_own" ON public.customers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "customers_insert_own" ON public.customers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "customers_update_own" ON public.customers FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "customers_delete_own" ON public.customers FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "projects_select_own" ON public.projects FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "projects_insert_own" ON public.projects FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "projects_update_own" ON public.projects FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "projects_delete_own" ON public.projects FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "catalog_items_select_own" ON public.catalog_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "catalog_items_insert_own" ON public.catalog_items FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_items_update_own" ON public.catalog_items FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_items_delete_own" ON public.catalog_items FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "qbo_mappings_select_own" ON public.qbo_account_mappings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "qbo_mappings_insert_own" ON public.qbo_account_mappings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "qbo_mappings_update_own" ON public.qbo_account_mappings FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "qbo_mappings_delete_own" ON public.qbo_account_mappings FOR DELETE USING (user_id = auth.uid());

-- ── Child tables (own via parent project's user_id) ──
CREATE POLICY "work_areas_select_own" ON public.work_areas FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = work_areas.project_id AND p.user_id = auth.uid()));
CREATE POLICY "work_areas_insert_own" ON public.work_areas FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = work_areas.project_id AND p.user_id = auth.uid()));
CREATE POLICY "work_areas_update_own" ON public.work_areas FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = work_areas.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = work_areas.project_id AND p.user_id = auth.uid()));
CREATE POLICY "work_areas_delete_own" ON public.work_areas FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = work_areas.project_id AND p.user_id = auth.uid()));

CREATE POLICY "proposals_select_own" ON public.proposals FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = proposals.project_id AND p.user_id = auth.uid()));
CREATE POLICY "proposals_insert_own" ON public.proposals FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = proposals.project_id AND p.user_id = auth.uid()));
CREATE POLICY "proposals_update_own" ON public.proposals FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = proposals.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = proposals.project_id AND p.user_id = auth.uid()));
CREATE POLICY "proposals_delete_own" ON public.proposals FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = proposals.project_id AND p.user_id = auth.uid()));

CREATE POLICY "proposal_line_items_select_own" ON public.proposal_line_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.proposals pr JOIN public.projects p ON p.id = pr.project_id
    WHERE pr.id = proposal_line_items.proposal_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "proposal_line_items_insert_own" ON public.proposal_line_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.proposals pr JOIN public.projects p ON p.id = pr.project_id
    WHERE pr.id = proposal_line_items.proposal_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "proposal_line_items_update_own" ON public.proposal_line_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.proposals pr JOIN public.projects p ON p.id = pr.project_id
    WHERE pr.id = proposal_line_items.proposal_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.proposals pr JOIN public.projects p ON p.id = pr.project_id
    WHERE pr.id = proposal_line_items.proposal_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "proposal_line_items_delete_own" ON public.proposal_line_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.proposals pr JOIN public.projects p ON p.id = pr.project_id
    WHERE pr.id = proposal_line_items.proposal_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "measurements_select_own" ON public.measurements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = measurements.project_id AND p.user_id = auth.uid()));
CREATE POLICY "measurements_insert_own" ON public.measurements FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = measurements.project_id AND p.user_id = auth.uid()));
CREATE POLICY "measurements_update_own" ON public.measurements FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = measurements.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = measurements.project_id AND p.user_id = auth.uid()));
CREATE POLICY "measurements_delete_own" ON public.measurements FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = measurements.project_id AND p.user_id = auth.uid()));

CREATE POLICY "project_files_select_own" ON public.project_files FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.user_id = auth.uid()));
CREATE POLICY "project_files_insert_own" ON public.project_files FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.user_id = auth.uid()));
CREATE POLICY "project_files_update_own" ON public.project_files FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.user_id = auth.uid()));
CREATE POLICY "project_files_delete_own" ON public.project_files FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.user_id = auth.uid()));

-- ============================================================
-- AUTH LAYER 1 LOCKDOWN — email allowlist trigger
-- ============================================================
-- PHASE 1 LOCKDOWN — REMOVE WHEN OPENING TO PUBLIC.
-- The allowlist email is hardcoded here AND in
-- src/lib/authAllowlist.ts (client-side guard). Both must match.
-- Reason: env-var allowlists silently fail open if the var is
-- ever unset; a code-level constant is loud to change and makes
-- the security boundary visible in code review.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_email_allowlist()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM 'ianm@blueclawassociates.com' THEN
    RAISE EXCEPTION 'Signup not permitted for this email during Phase 1 lockdown'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_email_allowlist_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_allowlist();

-- ============================================================
-- AUTH: handle_new_user — auto-create profile, grant ai_pro to Ian
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
BEGIN
  v_tier := CASE
    WHEN NEW.email = 'ianm@blueclawassociates.com' THEN 'ai_pro'
    ELSE 'free'
  END;

  INSERT INTO public.profiles (id, email, subscription_tier)
  VALUES (NEW.id, NEW.email, v_tier);

  RETURN NEW;
END;
$$;

CREATE TRIGGER handle_new_user_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STORAGE BUCKET: project-files (private)
-- Path convention: {user_id}/{project_id}/{filename}
-- RLS keys off the first folder segment matching auth.uid().
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-files', 'project-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "project_files_bucket_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "project_files_bucket_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "project_files_bucket_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'project-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "project_files_bucket_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
