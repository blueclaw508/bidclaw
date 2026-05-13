-- ================================================================
-- MIGRATION 002: BidClaw V2 — Data Model Rebuild
-- April 2026
-- ================================================================
-- Adds new columns to estimates table (project_type, plans, pass1_*)
-- Creates new relational tables: work_areas, line_items, measurements
-- Adds RLS policies, indexes
-- Safe to re-run (uses IF NOT EXISTS / DO blocks)
-- Does NOT drop or modify any existing columns
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- PART 1: Add new columns to estimates table
-- ════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'project_type'
  ) THEN
    ALTER TABLE estimates ADD COLUMN project_type TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'plans'
  ) THEN
    ALTER TABLE estimates ADD COLUMN plans JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'pass1_extraction'
  ) THEN
    ALTER TABLE estimates ADD COLUMN pass1_extraction JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'pass1_confidence'
  ) THEN
    ALTER TABLE estimates ADD COLUMN pass1_confidence TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'pass1_completed_at'
  ) THEN
    ALTER TABLE estimates ADD COLUMN pass1_completed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estimates' AND column_name = 'status'
  ) THEN
    ALTER TABLE estimates ADD COLUMN status TEXT DEFAULT 'draft';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- PART 2: Create work_areas table (relational, replaces JSONB)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS work_areas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  scope_description TEXT,
  pass2_mode        TEXT,              -- "mode1" (full) | "mode2" (questions)
  pass2_raw         JSONB,             -- raw Jamie JSON response
  gap_questions     JSONB,             -- [{question, answer, answered_at}]
  pass2_completed_at TIMESTAMPTZ
);

-- ════════════════════════════════════════════════════════════════
-- PART 3: Create line_items table (relational, replaces JSONB)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_area_id      UUID NOT NULL REFERENCES work_areas(id) ON DELETE CASCADE,
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  name              TEXT NOT NULL,
  qty               NUMERIC NOT NULL,
  unit              TEXT NOT NULL,
  category          TEXT NOT NULL,     -- Materials, Equipment, Labor, Subcontractor, Other
  catalog_item_id   UUID,              -- QC catalog item ID if matched
  match_status      TEXT,              -- exact | fuzzy | new | manual
  source            TEXT DEFAULT 'jamie',  -- jamie | user_added | user_edited
  original_name     TEXT               -- preserved even if user renames
);

-- ════════════════════════════════════════════════════════════════
-- PART 4: Create measurements table
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS measurements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  work_area_id      UUID REFERENCES work_areas(id) ON DELETE SET NULL,
  plan_index        INTEGER,           -- which uploaded plan (0-indexed)
  created_at        TIMESTAMPTZ DEFAULT now(),
  name              TEXT,
  shape             TEXT,              -- "rectangle" | "polygon" | "linear"
  area_sf           NUMERIC,
  linear_ft         NUMERIC,
  length_ft         NUMERIC,
  width_ft          NUMERIC,
  vertices          JSONB,             -- [{x, y}] pixel coordinates
  scale_ppi         NUMERIC            -- pixels per foot for this plan
);

-- ════════════════════════════════════════════════════════════════
-- PART 5: Row Level Security
-- ════════════════════════════════════════════════════════════════

ALTER TABLE work_areas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'work_areas' AND policyname = 'Users manage own work areas') THEN
    CREATE POLICY "Users manage own work areas" ON work_areas
      FOR ALL
      USING (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()))
      WITH CHECK (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()));
  END IF;
END $$;

ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'line_items' AND policyname = 'Users manage own line items') THEN
    CREATE POLICY "Users manage own line items" ON line_items
      FOR ALL
      USING (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()))
      WITH CHECK (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()));
  END IF;
END $$;

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'measurements' AND policyname = 'Users manage own measurements') THEN
    CREATE POLICY "Users manage own measurements" ON measurements
      FOR ALL
      USING (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()))
      WITH CHECK (estimate_id IN (SELECT id FROM estimates WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- PART 6: Indexes
-- ════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_work_areas_estimate ON work_areas(estimate_id);
CREATE INDEX IF NOT EXISTS idx_line_items_work_area ON line_items(work_area_id);
CREATE INDEX IF NOT EXISTS idx_line_items_estimate ON line_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_measurements_estimate ON measurements(estimate_id);
CREATE INDEX IF NOT EXISTS idx_measurements_work_area ON measurements(work_area_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status_v2 ON estimates(user_id, status);

NOTIFY pgrst, 'reload schema';
