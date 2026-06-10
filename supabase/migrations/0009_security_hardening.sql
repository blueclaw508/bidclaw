-- ============================================================
-- 0009 — Security hardening (advisor-driven), June 2026
-- Applied to prod via Supabase MCP apply_migration on 2026-06-10
-- as: security_hardening_orphan_table_definer_execute_search_paths
-- ============================================================

-- 1. Drop public.proposal_line_items — orphan from migration 0001.
--    Advisor flag: RLS enabled with ZERO policies. Liveness check
--    before drop: zero rows, zero inbound FKs, zero live code
--    references (the editor uses public.proposal_lines, created in
--    migration 0008; the only grep hit was 0001 itself).
DROP TABLE public.proposal_line_items;

-- 2. Revoke EXECUTE on SECURITY DEFINER trigger functions from API
--    roles. These fire from triggers on auth.users only
--    (handle_new_user_trigger + enforce_email_allowlist_trigger,
--    both verified present); trigger execution is unaffected by
--    EXECUTE revocation from API roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enforce_email_allowlist() FROM anon, authenticated, public;

-- 3. Pin search_path on flagged functions (advisor: role mutable
--    search_path). Function bodies read + verified BEFORE pinning:
--      tg_set_updated_at        — uses only now() (pg_catalog)
--      handle_new_user          — already schema-qualifies all 4
--                                 table refs (public.profiles,
--                                 public.company_settings,
--                                 public.company_labor_types,
--                                 public.company_equipment_rates)
--      enforce_email_allowlist  — references no tables at all
--    All three safe under an empty search_path.
ALTER FUNCTION public.tg_set_updated_at() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.enforce_email_allowlist() SET search_path = '';

-- Post-migration advisor state: only auth_leaked_password_protection
-- remains (dashboard setting, not SQL; deferred — auth is magic-link
-- only during Phase 1 lockdown).
