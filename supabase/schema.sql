-- ============================================================
-- BidClaw Tables — Added to QuickCalc Supabase Project
-- QuickCalc owns: auth, company profiles (kyn_user_settings),
-- catalogs (kyn_catalog_items). BidClaw reads those + writes these.
-- ============================================================

-- Profiles table additions (run against existing profiles table):
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'free';
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bidclaw_free_access boolean DEFAULT false;

-- Item Catalog additions (run against existing kyn_catalog_items table):
-- ALTER TABLE kyn_catalog_items ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
-- ALTER TABLE kyn_catalog_items ADD COLUMN IF NOT EXISTS needs_pricing boolean DEFAULT false;

-- BidClaw Production Rates (spec Section 6, Tab 3)
CREATE TABLE IF NOT EXISTS production_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  task_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  crew_size INTEGER DEFAULT 2,
  hours_per_unit NUMERIC(10,4) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- BidClaw Estimates (spec Section 9)
CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_name TEXT,
  project_name TEXT,
  project_address TEXT,
  project_description TEXT,
  plan_file_urls TEXT[] DEFAULT '{}',
  workflow_step INTEGER DEFAULT 1,
  work_areas JSONB,
  line_items JSONB,
  new_catalog_items_created JSONB,
  approval_status TEXT DEFAULT 'draft',
  sent_to_quickcalc_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Legacy tables (kept for backward compat during migration)

CREATE TABLE IF NOT EXISTS bidclaw_production_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  work_type TEXT NOT NULL,
  unit TEXT NOT NULL,
  man_hours_per_unit NUMERIC NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS bidclaw_disposal_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  um TEXT
);

CREATE TABLE IF NOT EXISTS bidclaw_work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  default_notes_template TEXT
);

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

CREATE TABLE IF NOT EXISTS bidclaw_job_efficiency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID REFERENCES bidclaw_estimates(id) ON DELETE CASCADE NOT NULL UNIQUE,
  budgeted_man_hours NUMERIC NOT NULL,
  actual_man_hours NUMERIC,
  efficiency_percent NUMERIC,
  notes TEXT,
  tracked_at TIMESTAMPTZ DEFAULT now()
);

-- Triggers

CREATE OR REPLACE FUNCTION bidclaw_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimates_updated_at ON estimates;
CREATE TRIGGER estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION bidclaw_update_updated_at();

DROP TRIGGER IF EXISTS production_rates_updated_at ON production_rates;
CREATE TRIGGER production_rates_updated_at
  BEFORE UPDATE ON production_rates
  FOR EACH ROW EXECUTE FUNCTION bidclaw_update_updated_at();

DROP TRIGGER IF EXISTS bidclaw_estimates_updated_at ON bidclaw_estimates;
CREATE TRIGGER bidclaw_estimates_updated_at
  BEFORE UPDATE ON bidclaw_estimates
  FOR EACH ROW EXECUTE FUNCTION bidclaw_update_updated_at();

-- Row Level Security

ALTER TABLE production_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_production_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_disposal_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_work_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_job_efficiency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own production rates" ON production_rates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own estimates" ON estimates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bidclaw_rates_policy" ON bidclaw_production_rates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bidclaw_disposal_policy" ON bidclaw_disposal_catalog FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bidclaw_work_types_policy" ON bidclaw_work_types FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bidclaw_estimates_policy" ON bidclaw_estimates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bidclaw_work_areas_policy" ON bidclaw_work_areas FOR ALL
  USING (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()))
  WITH CHECK (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()));

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

CREATE POLICY "bidclaw_efficiency_policy" ON bidclaw_job_efficiency FOR ALL
  USING (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()))
  WITH CHECK (estimate_id IN (SELECT id FROM bidclaw_estimates WHERE user_id = auth.uid()));

-- Indexes

CREATE INDEX IF NOT EXISTS idx_estimates_user ON estimates(user_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(user_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_production_rates_user ON production_rates(user_id);
CREATE INDEX IF NOT EXISTS idx_bidclaw_estimates_user ON bidclaw_estimates(user_id);
CREATE INDEX IF NOT EXISTS idx_bidclaw_estimates_status ON bidclaw_estimates(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bidclaw_work_areas_estimate ON bidclaw_work_areas(estimate_id);
CREATE INDEX IF NOT EXISTS idx_bidclaw_line_items_area ON bidclaw_line_items(work_area_id);

NOTIFY pgrst, 'reload schema';
