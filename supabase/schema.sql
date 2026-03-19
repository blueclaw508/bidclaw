-- ============================================================
-- BidClaw Tables — Added to QuickCalc's Supabase Project
-- These tables are BidClaw-specific. QuickCalc owns auth,
-- company profiles (kyn_user_settings), and catalogs (kyn_catalog_items).
-- BidClaw reads from those and writes to these.
-- ============================================================

-- BidClaw production rates (per user)
CREATE TABLE IF NOT EXISTS bidclaw_production_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  work_type TEXT NOT NULL,
  unit TEXT NOT NULL,
  man_hours_per_unit NUMERIC NOT NULL,
  notes TEXT
);

-- BidClaw disposal fees catalog (per user)
CREATE TABLE IF NOT EXISTS bidclaw_disposal_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  um TEXT
);

-- BidClaw work types library (per user)
CREATE TABLE IF NOT EXISTS bidclaw_work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  default_notes_template TEXT
);

-- BidClaw estimates
CREATE TABLE IF NOT EXISTS bidclaw_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  job_address TEXT,
  job_city TEXT,
  job_state TEXT,
  job_zip TEXT,
  spec_source TEXT NOT NULL DEFAULT 'site_visit',
  plan_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  ai_conversation JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- BidClaw work areas (crew size + hours per area)
CREATE TABLE IF NOT EXISTS bidclaw_work_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID REFERENCES bidclaw_estimates(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  ai_generated BOOLEAN DEFAULT true,
  approved BOOLEAN DEFAULT false,
  notes TEXT[] DEFAULT '{}',
  total_man_hours NUMERIC,
  crew_size INT DEFAULT 3,
  crew_hours_per_day NUMERIC DEFAULT 9,
  day_increment TEXT
);

-- BidClaw line items (quantities only — no costs)
CREATE TABLE IF NOT EXISTS bidclaw_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_area_id UUID REFERENCES bidclaw_work_areas(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity NUMERIC DEFAULT 0,
  unit TEXT,
  ai_generated BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

-- BidClaw job efficiency tracking
CREATE TABLE IF NOT EXISTS bidclaw_job_efficiency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID REFERENCES bidclaw_estimates(id) ON DELETE CASCADE NOT NULL UNIQUE,
  budgeted_man_hours NUMERIC NOT NULL,
  actual_man_hours NUMERIC,
  efficiency_percent NUMERIC,
  notes TEXT,
  tracked_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on estimates
CREATE OR REPLACE FUNCTION bidclaw_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bidclaw_estimates_updated_at ON bidclaw_estimates;
CREATE TRIGGER bidclaw_estimates_updated_at
  BEFORE UPDATE ON bidclaw_estimates
  FOR EACH ROW EXECUTE FUNCTION bidclaw_update_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

ALTER TABLE bidclaw_production_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_disposal_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_work_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_job_efficiency ENABLE ROW LEVEL SECURITY;

-- Production rates
CREATE POLICY "bidclaw_rates_policy" ON bidclaw_production_rates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Disposal catalog
CREATE POLICY "bidclaw_disposal_policy" ON bidclaw_disposal_catalog FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Work types
CREATE POLICY "bidclaw_work_types_policy" ON bidclaw_work_types FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Estimates
CREATE POLICY "bidclaw_estimates_policy" ON bidclaw_estimates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Work areas (via estimate ownership)
CREATE POLICY "bidclaw_work_areas_policy" ON bidclaw_work_areas FOR ALL
  USING (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()))
  WITH CHECK (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()));

-- Line items (via work area → estimate ownership)
CREATE POLICY "bidclaw_line_items_policy" ON bidclaw_line_items FOR ALL
  USING (work_area_id IN (
    SELECT wa.id FROM bidclaw_work_areas wa
    JOIN bidclaw_estimates e ON wa.estimate_id = e.id
    WHERE e.user_id = auth.uid()
  ))
  WITH CHECK (work_area_id IN (
    SELECT wa.id FROM bidclaw_work_areas wa
    JOIN bidclaw_estimates e ON wa.estimate_id = e.id
    WHERE e.user_id = auth.uid()
  ));

-- Job efficiency
CREATE POLICY "bidclaw_efficiency_policy" ON bidclaw_job_efficiency FOR ALL
  USING (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()))
  WITH CHECK (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bidclaw_estimates_user ON bidclaw_estimates(user_id);
CREATE INDEX IF NOT EXISTS idx_bidclaw_estimates_status ON bidclaw_estimates(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bidclaw_work_areas_estimate ON bidclaw_work_areas(estimate_id);
CREATE INDEX IF NOT EXISTS idx_bidclaw_line_items_area ON bidclaw_line_items(work_area_id);

NOTIFY pgrst, 'reload schema';
