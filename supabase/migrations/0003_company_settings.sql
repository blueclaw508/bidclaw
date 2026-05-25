-- ============================================================
-- 0003_company_settings.sql
-- ============================================================
-- Phase 2 Prompt 4 — Setup wizard + Company Info + KYN settings.
--
-- Stores per-user business metadata + Know Your Numbers rates so
-- subsequent Phase 2 prompts (manual proposal creation, Jamie,
-- offline upload) have something to price against. 1:1 with profiles
-- via user_id — auth concerns stay in profiles, business metadata
-- + KYN lives here.
--
-- setup_completed_at IS NULL gates "wizard incomplete"; the row
-- itself exists from signup time onwards via the extended
-- handle_new_user trigger below.

CREATE TABLE public.company_settings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       UUID NOT NULL UNIQUE
                                  REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Company info (all nullable — wizard / settings page populates)
  company_legal_name            TEXT,
  company_dba                   TEXT,
  company_address_street        TEXT,
  company_address_city          TEXT,
  company_address_state         TEXT,
  company_address_zip           TEXT,
  company_phone                 TEXT,
  company_email                 TEXT,
  company_website               TEXT,
  license_numbers               TEXT,
  ein                           TEXT,
  company_logo_path             TEXT,
  default_terms_and_conditions  TEXT,
  service_area                  TEXT,

  -- Know Your Numbers (all nullable until contractor enters them)
  default_labor_rate            NUMERIC(10, 2),
  overhead_percent              NUMERIC(5, 2),
  markup_materials_percent      NUMERIC(5, 2),
  markup_labor_percent          NUMERIC(5, 2),
  markup_equipment_percent      NUMERIC(5, 2),
  markup_subcontract_percent    NUMERIC(5, 2),

  -- Wizard gate. NULL = setup incomplete. Set when "Complete Setup"
  -- clicked. The data IS NOT the gate; this column is.
  setup_completed_at            TIMESTAMPTZ,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER company_settings_set_updated_at BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_company_settings_user_id ON public.company_settings(user_id);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_settings_select_own" ON public.company_settings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "company_settings_insert_own" ON public.company_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "company_settings_update_own" ON public.company_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "company_settings_delete_own" ON public.company_settings FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- Extend handle_new_user — also create an empty company_settings
-- row whenever a new profile is created. Saves null-check + lazy-
-- create logic in every read path.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tier TEXT;
BEGIN
  v_tier := CASE
    WHEN NEW.email = 'ianm@blueclawassociates.com' THEN 'ai_pro'
    ELSE 'free'
  END;

  INSERT INTO public.profiles (id, email, subscription_tier)
  VALUES (NEW.id, NEW.email, v_tier);

  -- Phase 2 Prompt 4 — every profile gets an empty company_settings
  -- row at signup so reads don't need null-check + lazy-create.
  INSERT INTO public.company_settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Backfill: existing profiles (just Ian during Phase 1 lockdown)
-- need a company_settings row since their profile predates this
-- migration. Idempotent via NOT EXISTS — safe if migration retries.
-- ============================================================
INSERT INTO public.company_settings (user_id)
SELECT id FROM public.profiles
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_settings WHERE user_id = profiles.id
);

-- ============================================================
-- Storage bucket — company-assets (logos, future signature images,
-- etc). Private, path-prefix RLS keyed on auth.uid()::text as the
-- first folder segment. Mirrors the project-files bucket pattern
-- from Phase 6 of Prompt 2.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "company_assets_bucket_select_own" ON storage.objects FOR SELECT
  USING (
    (bucket_id = 'company-assets'::text)
    AND ((auth.uid())::text = (storage.foldername(name))[1])
  );

CREATE POLICY "company_assets_bucket_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (
    (bucket_id = 'company-assets'::text)
    AND ((auth.uid())::text = (storage.foldername(name))[1])
  );

CREATE POLICY "company_assets_bucket_update_own" ON storage.objects FOR UPDATE
  USING (
    (bucket_id = 'company-assets'::text)
    AND ((auth.uid())::text = (storage.foldername(name))[1])
  )
  WITH CHECK (
    (bucket_id = 'company-assets'::text)
    AND ((auth.uid())::text = (storage.foldername(name))[1])
  );

CREATE POLICY "company_assets_bucket_delete_own" ON storage.objects FOR DELETE
  USING (
    (bucket_id = 'company-assets'::text)
    AND ((auth.uid())::text = (storage.foldername(name))[1])
  );
