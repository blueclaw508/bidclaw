-- 0021 — J0: allow the RLS-probe fixture user through the signup lockdown
--
-- The Phase-1 lockdown trigger (enforce_email_allowlist) blocks every
-- signup except Ian's. The J0+ test harnesses need a SECOND user to prove
-- RLS isolation (scripts/test-jamie-gate.ts, and J7's fixture users).
--
-- jamie-rls-probe@bidclaw.test uses the RFC-reserved .test TLD: it cannot
-- receive mail, so no outsider can ever complete BidClaw's magic-link
-- auth with it. Only service-role harnesses (admin.generateLink) can sign
-- it in. This opens no real signup hole.

CREATE OR REPLACE FUNCTION public.enforce_email_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.email NOT IN (
    'ianm@blueclawassociates.com',
    'jamie-rls-probe@bidclaw.test'  -- test-harness fixture; .test TLD receives no mail
  ) THEN
    RAISE EXCEPTION 'Signup not permitted for this email during Phase 1 lockdown'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
