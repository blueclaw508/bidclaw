// ============================================================
// PHASE 1 LOCKDOWN — REMOVE WHEN OPENING TO PUBLIC.
// ============================================================
// During Phase 1 only this email may sign in to BidClaw. The
// same email is hardcoded in the Supabase trigger
// `public.enforce_email_allowlist()` (migration phase1_rls_auth_storage)
// so the DB rejects any other signup at the auth layer too.
//
// Both copies must match. Changing one without the other will
// either lock you out or let someone else in.
//
// Why a constant and not an env var: env vars introduce a silent
// fail-open mode (unset = no enforcement). A code-level constant
// is loud to change and visible in code review.
//
// To open Phase 1 to additional emails: delete this file, drop
// the Supabase trigger, audit every call site of
// `isEmailAllowed()`. Do not extend this constant in place; the
// fail-closed pattern only works for single-user lockdown.
// ============================================================

const ALLOWED_EMAIL = 'ianm@blueclawassociates.com'

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  return email.trim().toLowerCase() === ALLOWED_EMAIL
}

// INTENTIONALLY NOT EXPORTED. The allowlisted email must NEVER be rendered
// in any user-facing UI — that would leak which account has access to the
// system. If you need a public message about the lockdown, use a generic
// "private testing, contact info@blueclawgroup.com" line instead.
