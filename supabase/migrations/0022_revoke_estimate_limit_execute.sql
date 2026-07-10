-- 0022 — J0 hardening rider: close the RPC EXECUTE grant on the 0018
-- paywall trigger function (same pattern as 0009 for handle_new_user /
-- enforce_email_allowlist). enforce_estimate_limit is a SECURITY DEFINER
-- trigger fn — it should only ever fire from the proposals BEFORE INSERT
-- trigger, never via /rest/v1/rpc/. Flagged by the security advisor
-- during J0 verification.

REVOKE EXECUTE ON FUNCTION public.enforce_estimate_limit() FROM anon, authenticated, public;
