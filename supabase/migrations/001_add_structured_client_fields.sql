-- ================================================================
-- MIGRATION: Add structured client/address fields to estimates
-- ================================================================
-- Adds first_name, last_name, company_name, address_line, city,
-- state, zip, phone, email, estimate_name to the estimates table.
-- Keeps client_name and project_address as fallbacks.
-- Safe to re-run (uses IF NOT EXISTS via DO block).
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE estimates ADD COLUMN first_name TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE estimates ADD COLUMN last_name TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE estimates ADD COLUMN company_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'address_line'
  ) THEN
    ALTER TABLE estimates ADD COLUMN address_line TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'city'
  ) THEN
    ALTER TABLE estimates ADD COLUMN city TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'state'
  ) THEN
    ALTER TABLE estimates ADD COLUMN state TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'zip'
  ) THEN
    ALTER TABLE estimates ADD COLUMN zip TEXT DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'phone'
  ) THEN
    ALTER TABLE estimates ADD COLUMN phone TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'email'
  ) THEN
    ALTER TABLE estimates ADD COLUMN email TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'estimate_name'
  ) THEN
    ALTER TABLE estimates ADD COLUMN estimate_name TEXT;
  END IF;
END $$;

-- ================================================================
-- BACKFILL: Split client_name into first_name / last_name
-- ================================================================
UPDATE estimates
SET
  first_name = CASE
    WHEN position(' ' in trim(client_name)) > 0
    THEN left(trim(client_name), position(' ' in trim(client_name)) - 1)
    ELSE trim(client_name)
  END,
  last_name = CASE
    WHEN position(' ' in trim(client_name)) > 0
    THEN substring(trim(client_name) from position(' ' in trim(client_name)) + 1)
    ELSE ''
  END
WHERE (first_name IS NULL OR first_name = '')
  AND client_name IS NOT NULL
  AND trim(client_name) != '';

-- ================================================================
-- BACKFILL: Copy project_address into address_line
-- ================================================================
UPDATE estimates
SET address_line = trim(project_address)
WHERE (address_line IS NULL OR address_line = '')
  AND project_address IS NOT NULL
  AND trim(project_address) != '';
