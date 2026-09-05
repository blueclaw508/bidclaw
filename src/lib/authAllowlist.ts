// ============================================================
// PHASE 1 SIGNUP ALLOWLIST — CLIENT HALF
// ============================================================
// The list lives in public.beta_allowlist (migration 0034) and is
// service-role only: RLS on, no policies, so it cannot be read or written
// through the API. This module can ask whether ONE address is on it. It
// cannot read the list, so nothing about who has access reaches the
// browser or the bundle.
//
// That is the point of the rewrite. The previous version hardcoded the
// address here — which compiled it into dist/assets/index-*.js and served
// it to every visitor — directly under a comment insisting the email
// "must NEVER be rendered in any user-facing UI".
//
// THIS IS A COURTESY CHECK, NOT THE LOCK. Enforcement is the BEFORE INSERT
// trigger enforce_email_allowlist() on auth.users, which runs inside the
// database and cannot be reached from a browser. Everything here exists so
// a stranger gets a straight answer instead of an email that will never
// work — and so someone revoked mid-session doesn't keep the app open.
//
// To invite or revoke someone, change the TABLE. No deploy, no constant.
// ============================================================

import { supabase } from '@/lib/supabase'

/**
 * Is this address on the allowlist?
 *
 * Returns `null` — not `false` — when the question could not be answered
 * (offline, RPC error). The distinction is deliberate: "no" and "don't
 * know" call for different handling, and collapsing them into a falsy
 * value is how a dropped request turns into a user being signed out. Each
 * caller decides what to do with `null`, in the open, at the call site.
 */
export async function isEmailAllowed(
  email: string | null | undefined
): Promise<boolean | null> {
  const trimmed = email?.trim().toLowerCase()
  if (!trimmed) return false

  const { data, error } = await supabase.rpc('is_email_allowed', {
    p_email: trimmed,
  })
  if (error) {
    // Not fatal and not a denial — the caller chooses. Logged because a
    // persistent failure here means the sign-in form has quietly stopped
    // pre-checking, and the only symptom would be dead magic-link emails.
    console.error('allowlist check failed:', error.message)
    return null
  }
  return data === true
}
