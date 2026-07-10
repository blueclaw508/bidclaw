// Pure gate + lifecycle logic for the Jamie loop (J0). ZERO imports —
// deliberately free of the supabase client so scripts/test-jamie-gate.ts
// can import and exercise every deny path under node/tsx without the
// browser env. jamieLoop.ts wires this to real COUNT queries.

// ──────────────────────────────────────────────────────────────────────
// Founder mode (Loop Rule 8)
// ──────────────────────────────────────────────────────────────────────

/**
 * Until BidClaw Stripe tiering ships, canInvokeJamie() allows ONLY this
 * UUID (Ian) and denies everyone else with JAMIE_NOT_AVAILABLE. Metering
 * still records for the founder — enforcement thresholds just aren't
 * applied. Verified against auth.users in the J0 drift gate.
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
  | 'JAMIE_NOT_AVAILABLE' // founder-mode deny (everyone but Ian, pre-Stripe)

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
 * Founder-mode wrapper (Loop Rule 8): only the founder may invoke Jamie
 * pre-Stripe; thresholds are not applied to the founder (founder tier is
 * all-NULL anyway). Everyone else gets JAMIE_NOT_AVAILABLE regardless of
 * tier — flip this to tier-resolution when BidClaw Stripe ships (J-loop
 * exit criterion 4).
 */
export function evaluateFounderModeGate(
  userId: string,
  limits: TierLimits | null,
  usage: JamieUsage
): JamieGateResult {
  if (userId !== FOUNDER_USER_ID) {
    return deny(
      'JAMIE_NOT_AVAILABLE',
      'Jamie is not available on this account yet.'
    )
  }
  return evaluateJamieGate(limits, usage)
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
