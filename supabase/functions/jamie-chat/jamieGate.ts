// ⚠ VERBATIM COPY of src/lib/jamieGate.ts (single source of truth).
// The Deno runtime can't import from src/, so this file is duplicated.
// If you change the gate logic, change BOTH files in the same commit —
// scripts/verify-jamie.mjs asserts the copies are content-identical.

// Pure gate + lifecycle logic for the Jamie loop (J0). ZERO imports —
// deliberately free of the supabase client so scripts/test-jamie-gate.ts
// can import and exercise every deny path under node/tsx without the
// browser env. jamieLoop.ts wires this to real COUNT queries.

// ──────────────────────────────────────────────────────────────────────
// Tier resolution (replaced founder mode when Stripe shipped)
// ──────────────────────────────────────────────────────────────────────

/**
 * The founder's account. Resolves to the all-NULL `founder` tier —
 * unlimited, though metering still records every invocation.
 *
 * This UUID used to be the WHOLE gate: pre-Stripe, canInvokeJamie() allowed
 * only Ian and denied everyone else with JAMIE_NOT_AVAILABLE. That was
 * correct while nobody could pay, and became a bug the moment they could —
 * a Pro + AI subscriber would have been charged $499 and then refused. Now
 * it is just one tier key among several.
 */
export const FOUNDER_USER_ID = '38b28d49-88a3-43e1-a947-34f55b793d2e'

// ──────────────────────────────────────────────────────────────────────
// Gate types
// ──────────────────────────────────────────────────────────────────────

export type JamieGateCode =
  | 'UPGRADE_REQUIRED'   // tier has no Jamie at all (free / pro)
  | 'QUOTA_REACHED'      // monthly estimates or total-invocation ceiling hit
  | 'RATE_LIMIT'         // hourly invocation cap hit
  | 'IMAGE_LIMIT'        // per-session image cap hit
  | 'TURN_LIMIT'         // per-session chat-turn cap hit
  // Kept as a kill switch: no path emits it now that tiers decide access,
  // but a tier row that vanishes entirely still needs a code to fail with.
  | 'JAMIE_NOT_AVAILABLE'

export interface JamieGateResult {
  allowed: boolean
  code?: JamieGateCode
  reason?: string
}

/** subscription_tier_limits row. NULL limit = unlimited. */
export interface TierLimits {
  tier: string
  display_name: string
  monthly_manual_proposals: number | null
  monthly_jamie_estimates: number | null
  monthly_total_invocations: number | null
  jamie_invocations_per_hour: number | null
  images_per_jamie_session: number | null
  chat_turns_per_jamie_session: number | null
  jamie_overage_enabled: boolean
  jamie_overage_price_usd: number | null
}

/** Current usage counts the gate evaluates against. */
export interface JamieUsage {
  /** Committed Jamie estimates this month (counts_against_quota rows). */
  jamieEstimatesThisMonth: number
  /** ALL invocations this month — the rejection-loop ceiling input. */
  invocationsThisMonth: number
  /** Invocations in the trailing hour. */
  invocationsLastHour: number
  /** Images attached in the current session (run). */
  imagesThisSession: number
  /** Chat turns in the current session (run). */
  turnsThisSession: number
}

const allow = (): JamieGateResult => ({ allowed: true })
const deny = (code: JamieGateCode, reason: string): JamieGateResult => ({
  allowed: false,
  code,
  reason,
})

/**
 * Pure threshold evaluation: usage vs. a tier's limits. NULL limit =
 * unlimited (skip the check). Check order matters — the cheapest-to-fix
 * denial the user should see first:
 *   no-Jamie tier → monthly quota → total ceiling → hourly → image → turn.
 */
export function evaluateJamieGate(
  limits: TierLimits | null,
  usage: JamieUsage
): JamieGateResult {
  if (!limits || limits.monthly_jamie_estimates === 0) {
    return deny(
      'UPGRADE_REQUIRED',
      'Jamie estimates are not included in this plan. Upgrade to Pro + AI to turn Jamie on.'
    )
  }
  if (
    limits.monthly_jamie_estimates !== null &&
    usage.jamieEstimatesThisMonth >= limits.monthly_jamie_estimates
  ) {
    return deny(
      'QUOTA_REACHED',
      `You've used all ${limits.monthly_jamie_estimates} Jamie estimates this month.`
    )
  }
  if (
    limits.monthly_total_invocations !== null &&
    usage.invocationsThisMonth >= limits.monthly_total_invocations
  ) {
    return deny(
      'QUOTA_REACHED',
      "You've hit this month's Jamie activity ceiling. It resets on the 1st."
    )
  }
  if (
    limits.jamie_invocations_per_hour !== null &&
    usage.invocationsLastHour >= limits.jamie_invocations_per_hour
  ) {
    return deny('RATE_LIMIT', 'Jamie needs a breather — try again in a bit.')
  }
  if (
    limits.images_per_jamie_session !== null &&
    usage.imagesThisSession >= limits.images_per_jamie_session
  ) {
    return deny(
      'IMAGE_LIMIT',
      `This session is at its ${limits.images_per_jamie_session}-photo limit.`
    )
  }
  if (
    limits.chat_turns_per_jamie_session !== null &&
    usage.turnsThisSession >= limits.chat_turns_per_jamie_session
  ) {
    return deny(
      'TURN_LIMIT',
      'This Jamie session is at its message limit. Start a new session to keep going.'
    )
  }
  return allow()
}

/**
 * Which subscription_tier_limits row governs this user.
 *
 * The founder resolves to the all-NULL founder tier; everyone else to their
 * company_settings.plan, whose values are the same keys as the tier table
 * (`free` / `pro` / `pro_ai`) and have been since J0. An account with no
 * settings row, or a blank plan, is treated as free rather than as an
 * error — the caller then denies with UPGRADE_REQUIRED, which is both true
 * and actionable.
 *
 * Pure by design, like the rest of this file: the caller does the lookup
 * and hands the plan in, so the whole gate stays testable without a DB.
 */
export function tierKeyForUser(
  userId: string,
  plan: string | null | undefined
): string {
  if (userId === FOUNDER_USER_ID) return 'founder'
  return (plan ?? '').trim() || 'free'
}

/**
 * True when this tier includes Jamie at all — i.e. the deny would be
 * UPGRADE_REQUIRED no matter what the usage counts say.
 *
 * Callers use it to skip the live COUNT queries on an account that could
 * never pass: a free or Pro contractor opening a project should not cost
 * four aggregate queries to be told they need to upgrade.
 */
export function tierIncludesJamie(limits: TierLimits | null): boolean {
  return !!limits && limits.monthly_jamie_estimates !== 0
}

// ──────────────────────────────────────────────────────────────────────
// Run lifecycle — legal status transitions
// ──────────────────────────────────────────────────────────────────────

export type JamieRunStatus =
  | 'in_progress'
  | 'awaiting_wa_approval'
  | 'awaiting_line_approval'
  | 'committed'
  | 'rejected'
  | 'abandoned'
  | 'error'

/**
 * Legal transitions. committed/rejected are terminal; error and abandoned
 * can resume back to in_progress (retry / reopened session).
 */
export const JAMIE_RUN_TRANSITIONS: Record<JamieRunStatus, JamieRunStatus[]> = {
  in_progress: ['awaiting_wa_approval', 'error', 'abandoned'],
  awaiting_wa_approval: ['in_progress', 'awaiting_line_approval', 'rejected', 'error', 'abandoned'],
  awaiting_line_approval: ['committed', 'rejected', 'error', 'abandoned'],
  committed: [],
  rejected: [],
  abandoned: ['in_progress'],
  error: ['in_progress'],
}

export function isLegalRunTransition(
  from: JamieRunStatus,
  to: JamieRunStatus
): boolean {
  return JAMIE_RUN_TRANSITIONS[from]?.includes(to) ?? false
}
