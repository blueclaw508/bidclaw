-- ============================================================
-- 0004_company_settings_qc_alignment.sql
-- ============================================================
-- Phase 2 Prompt 4 mid-prompt scope correction. Original 0003 spec
-- was a generic SaaS settings template; this migration restructures
-- to match BlueQuickCalc (QC) exactly.
--
-- Architecture decisions locked here (carry-forward for Prompts 5+):
--   Q3a — Rates frozen at proposal creation. Settings + catalog items
--         display LIVE values. Proposals capture a snapshot.
--   Q3b — Catalog labor lines reference one of 5 settings rates by
--         default but can override inline.
--   Q3c — Labor + equipment are separate normalized tables
--         (5 + 10 slots respectively) rather than JSONB columns on
--         company_settings.

-- Drop columns that don't exist in QC
ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS company_dba,
  DROP COLUMN IF EXISTS company_address_street,
  DROP COLUMN IF EXISTS company_address_city,
  DROP COLUMN IF EXISTS company_address_state,
  DROP COLUMN IF EXISTS company_address_zip,
  DROP COLUMN IF EXISTS ein,
  DROP COLUMN IF EXISTS license_numbers,
  DROP COLUMN IF EXISTS service_area,
  DROP COLUMN IF EXISTS default_labor_rate,
  DROP COLUMN IF EXISTS overhead_percent,
  DROP COLUMN IF EXISTS markup_labor_percent,
  DROP COLUMN IF EXISTS markup_equipment_percent;

-- Rename to QC nomenclature (subcontract → subs)
ALTER TABLE public.company_settings
  RENAME COLUMN markup_subcontract_percent TO markup_subs_percent;

-- Add QC-aligned columns
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS owner_name              TEXT,
  ADD COLUMN IF NOT EXISTS company_address         TEXT,
  ADD COLUMN IF NOT EXISTS pdf_primary_color       TEXT,
  ADD COLUMN IF NOT EXISTS pdf_footer_text         TEXT,
  ADD COLUMN IF NOT EXISTS pdf_show_logo           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_email          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_phone          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_address        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pdf_show_website        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS markup_freight_percent  NUMERIC(5, 2);

-- ============================================================
-- company_labor_types — 5 slots per user
-- ============================================================
CREATE TABLE public.company_labor_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_number   INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 5),
  name          TEXT,
  rate_per_hour NUMERIC(10, 2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, slot_number)
);

ALTER TABLE public.company_labor_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_labor_types_select_own" ON public.company_labor_types FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "company_labor_types_insert_own" ON public.company_labor_types FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "company_labor_types_update_own" ON public.company_labor_types FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "company_labor_types_delete_own" ON public.company_labor_types FOR DELETE
  USING (user_id = auth.uid());

CREATE TRIGGER company_labor_types_set_updated_at BEFORE UPDATE ON public.company_labor_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_company_labor_types_user_id ON public.company_labor_types(user_id);

-- ============================================================
-- company_equipment_rates — 10 slots per user
-- ============================================================
CREATE TABLE public.company_equipment_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_number   INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
  name          TEXT,
  rate_per_hour NUMERIC(10, 2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, slot_number)
);

ALTER TABLE public.company_equipment_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_equipment_rates_select_own" ON public.company_equipment_rates FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "company_equipment_rates_insert_own" ON public.company_equipment_rates FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "company_equipment_rates_update_own" ON public.company_equipment_rates FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "company_equipment_rates_delete_own" ON public.company_equipment_rates FOR DELETE
  USING (user_id = auth.uid());

CREATE TRIGGER company_equipment_rates_set_updated_at BEFORE UPDATE ON public.company_equipment_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_company_equipment_rates_user_id ON public.company_equipment_rates(user_id);

-- ============================================================
-- Extend handle_new_user — also pre-create 5 labor + 10 equipment
-- slots on signup so reads don't need null-check + lazy-create.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tier TEXT;
  v_slot INTEGER;
BEGIN
  v_tier := CASE
    WHEN NEW.email = 'ianm@blueclawassociates.com' THEN 'ai_pro'
    ELSE 'free'
  END;

  INSERT INTO public.profiles (id, email, subscription_tier)
  VALUES (NEW.id, NEW.email, v_tier);

  INSERT INTO public.company_settings (user_id) VALUES (NEW.id);

  -- 5 labor type slots
  FOR v_slot IN 1..5 LOOP
    INSERT INTO public.company_labor_types (user_id, slot_number)
    VALUES (NEW.id, v_slot);
  END LOOP;

  -- 10 equipment rate slots
  FOR v_slot IN 1..10 LOOP
    INSERT INTO public.company_equipment_rates (user_id, slot_number)
    VALUES (NEW.id, v_slot);
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Backfill — existing profiles (Ian) need their slot rows.
-- Idempotent via NOT EXISTS.
-- ============================================================
INSERT INTO public.company_labor_types (user_id, slot_number)
SELECT p.id, s.slot_number
FROM public.profiles p
CROSS JOIN generate_series(1, 5) AS s(slot_number)
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_labor_types t
  WHERE t.user_id = p.id AND t.slot_number = s.slot_number
);

INSERT INTO public.company_equipment_rates (user_id, slot_number)
SELECT p.id, s.slot_number
FROM public.profiles p
CROSS JOIN generate_series(1, 10) AS s(slot_number)
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_equipment_rates t
  WHERE t.user_id = p.id AND t.slot_number = s.slot_number
);
