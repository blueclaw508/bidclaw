-- 0020 — J0: Jamie loop data foundations (staging + metering + tier gate)
--
-- THE JAMIE LOOP phase J0. Drift-gate reconciliations vs. the spec (Ian
-- approved both on 2026-07-10):
--   • Runs anchor to PROJECTS, not proposals. BidClaw is estimate-first
--     (R4/R6/R8): content is created in work_areas/work_area_lines and
--     proposals are frozen snapshots. Jamie's approved output commits into
--     the ESTIMATE world through the existing data layer; proposal
--     generation stays untouched.
--   • Table names avoid the live Phase-1 `jamie_runs` (single-shot
--     jamie-estimate flow, kept live until J6): loop tables are
--     jamie_loop_runs / jamie_messages / jamie_proposed_work_areas /
--     jamie_proposed_lines / jamie_invocations / subscription_tier_limits.
--   • Line category CHECK mirrors work_area_lines exactly
--     ('subcontractor', not the spec's 'sub').
--   • Tier seeds use the SHIPPED plan names (company_settings.plan from
--     0018: free / pro / pro_ai) + founder + a dormant pro_ai_plus,
--     not the spec's QuickCalc-era qc_* names.

-- ──────────────────────────────────────────────────────────────────────
-- 1. jamie_loop_runs — one conversational estimating session per project
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE jamie_loop_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','awaiting_wa_approval',
                      'awaiting_line_approval','committed','rejected',
                      'abandoned','error')),
  input_summary TEXT,          -- short human-readable description of what was provided
  image_count INTEGER NOT NULL DEFAULT 0,
  chat_turn_count INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jamie_loop_runs_user ON jamie_loop_runs (user_id);
CREATE INDEX idx_jamie_loop_runs_project ON jamie_loop_runs (project_id);

CREATE TRIGGER trg_jamie_loop_runs_updated_at
  BEFORE UPDATE ON jamie_loop_runs
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 2. jamie_messages — conversation persistence per run
--    content is JSONB text blocks + image STORAGE REFS, never raw base64
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE jamie_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jamie_run_id UUID NOT NULL REFERENCES jamie_loop_runs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jamie_messages_run ON jamie_messages (jamie_run_id, created_at);

-- ──────────────────────────────────────────────────────────────────────
-- 3. jamie_proposed_work_areas — Pass 1 staging (Gate 1 reviews these)
--    Approval commits a real work_areas row; rejected rows are RETAINED
--    (audit trail — never deleted).
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE jamie_proposed_work_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jamie_run_id UUID NOT NULL REFERENCES jamie_loop_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  proposed_name TEXT NOT NULL,
  proposed_description TEXT,
  -- Suggested match to an EXISTING contractor-created work area, if one
  -- plausibly covers this scope (Jamie is additive-only; she never edits it).
  source_work_area_id UUID NULL REFERENCES work_areas(id) ON DELETE SET NULL,
  -- Set at Gate-1 approval: the real work_areas row this staged WA became.
  inserted_work_area_id UUID NULL REFERENCES work_areas(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_jamie_pwa_run ON jamie_proposed_work_areas (jamie_run_id);

-- ──────────────────────────────────────────────────────────────────────
-- 4. jamie_proposed_lines — Pass 2 staging (Gate 2 reviews these)
--    Approval commits into work_area_lines via the existing data layer.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE jamie_proposed_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jamie_proposed_work_area_id UUID NOT NULL
    REFERENCES jamie_proposed_work_areas(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  -- Mirrors work_area_lines_category_check exactly.
  category TEXT NOT NULL
    CHECK (category IN ('labor','material','equipment','subcontractor','other')),
  label TEXT NOT NULL,
  unit TEXT,
  quantity NUMERIC,
  unit_cost NUMERIC,
  kit_id UUID NULL REFERENCES kits(id) ON DELETE SET NULL,
  catalog_item_id UUID NULL REFERENCES catalog_items(id) ON DELETE SET NULL,
  reasoning TEXT,                              -- Jamie's stated basis for this line
  needs_pricing BOOLEAN NOT NULL DEFAULT FALSE, -- catalog-miss lines created at $0.00
  -- Set at Gate-2 commit: the real work_area_lines row this became.
  inserted_work_area_line_id UUID NULL REFERENCES work_area_lines(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_jamie_pl_pwa ON jamie_proposed_lines (jamie_proposed_work_area_id);

-- ──────────────────────────────────────────────────────────────────────
-- 5. jamie_invocations — token/cost accounting, one row per API round trip
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE jamie_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jamie_run_id UUID NOT NULL REFERENCES jamie_loop_runs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  -- Generated column, NOT an expression index on DATE_TRUNC: date_trunc on
  -- timestamptz is only STABLE, but on the AT TIME ZONE 'UTC' plain
  -- timestamp it is IMMUTABLE, so a STORED column works where the index
  -- expression would not.
  quota_month DATE GENERATED ALWAYS AS
    ((DATE_TRUNC('month', started_at AT TIME ZONE 'UTC'))::date) STORED,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10,4),
  image_count INTEGER DEFAULT 0,
  chat_turn_number INTEGER,
  outcome TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (outcome IN ('in_progress','committed','rejected','abandoned','error')),
  -- Flipped TRUE only when the run COMMITS (both gates passed = 1 Jamie
  -- estimate). Gate-1-pass + gate-2-reject stays FALSE (locked decision).
  counts_against_quota BOOLEAN NOT NULL DEFAULT FALSE
);

-- Quota check: direct COUNT against this partial index (no materialized view).
CREATE INDEX idx_jamie_inv_quota
  ON jamie_invocations (user_id, quota_month)
  WHERE counts_against_quota;
-- Hourly rate-limit lookups.
CREATE INDEX idx_jamie_inv_rate
  ON jamie_invocations (user_id, started_at DESC);
CREATE INDEX idx_jamie_inv_run ON jamie_invocations (jamie_run_id);

-- ──────────────────────────────────────────────────────────────────────
-- 6. subscription_tier_limits — config table (read-only to clients)
--    NULL limit = unlimited. Tier keys match company_settings.plan
--    (0018) + 'founder' (resolved by UUID, not plan) + dormant
--    'pro_ai_plus' (backlog Pro+ tier).
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE subscription_tier_limits (
  tier TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  monthly_price_usd NUMERIC NULL,
  stripe_price_id TEXT NULL,
  monthly_manual_proposals INTEGER NULL,
  monthly_jamie_estimates INTEGER NULL,
  monthly_total_invocations INTEGER NULL,  -- rejection-loop ceiling (loophole fix)
  jamie_invocations_per_hour INTEGER NULL,
  images_per_jamie_session INTEGER NULL,
  chat_turns_per_jamie_session INTEGER NULL,
  jamie_overage_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  jamie_overage_price_usd NUMERIC NULL
);

INSERT INTO subscription_tier_limits
  (tier, display_name, monthly_price_usd, monthly_manual_proposals,
   monthly_jamie_estimates, monthly_total_invocations,
   jamie_invocations_per_hour, images_per_jamie_session,
   chat_turns_per_jamie_session, jamie_overage_enabled, jamie_overage_price_usd)
VALUES
  -- Matches the live enforce_estimate_limit trigger (0018): 5 manual/month.
  ('free',        'Free',          0,   5,    0,    0,    0,    0,    0,  FALSE, NULL),
  ('pro',         'Pro',           39,  NULL, 0,    0,    0,    0,    0,  FALSE, NULL),
  ('pro_ai',      'Pro + AI',      499, NULL, 30,   100,  10,   10,   8,  TRUE,  7),
  -- Dormant future tier (Pro+ surface is standing backlog).
  ('pro_ai_plus', 'Pro + AI Plus', NULL, NULL, 100, 300,  20,   15,   12, TRUE,  5),
  -- Founder: all NULL = unlimited; metering still records everything.
  ('founder',     'Founder',       NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NULL)
ON CONFLICT (tier) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- 7. RLS — owner-only; staged tables scope through their parent run
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE jamie_loop_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jamie_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE jamie_proposed_work_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE jamie_proposed_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE jamie_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tier_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY jamie_loop_runs_owner ON jamie_loop_runs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY jamie_messages_owner ON jamie_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM jamie_loop_runs r
    WHERE r.id = jamie_run_id AND r.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM jamie_loop_runs r
    WHERE r.id = jamie_run_id AND r.user_id = (SELECT auth.uid())));

CREATE POLICY jamie_pwa_owner ON jamie_proposed_work_areas
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM jamie_loop_runs r
    WHERE r.id = jamie_run_id AND r.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM jamie_loop_runs r
    WHERE r.id = jamie_run_id AND r.user_id = (SELECT auth.uid())));

CREATE POLICY jamie_pl_owner ON jamie_proposed_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM jamie_proposed_work_areas pwa
    JOIN jamie_loop_runs r ON r.id = pwa.jamie_run_id
    WHERE pwa.id = jamie_proposed_work_area_id
      AND r.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM jamie_proposed_work_areas pwa
    JOIN jamie_loop_runs r ON r.id = pwa.jamie_run_id
    WHERE pwa.id = jamie_proposed_work_area_id
      AND r.user_id = (SELECT auth.uid())));

-- Invocations: owner can read (usage meter) and write; J1 moves writes
-- server-side (service role bypasses RLS). Spoofed client rows only ever
-- count against the spoofing user's own quota.
CREATE POLICY jamie_inv_owner ON jamie_invocations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Tier limits: read-only reference data for any signed-in user.
-- No INSERT/UPDATE/DELETE policies = no client writes.
CREATE POLICY tier_limits_read ON subscription_tier_limits
  FOR SELECT TO authenticated
  USING (true);
