// BidClaw entitlements — the subscription gate (paywall).
//
// The free tier is a TRIAL, not a plan: one proposal, for life. Build it,
// price it, print it — but it prints watermarked and it cannot be sent.
// Ian, 2026-09-04: "one estimate/proposal for free once they register",
// then watermark it and gate sending until they subscribe.
//
// WHAT IS ACTUALLY ENFORCED, and where. This module is a client-side READ.
// It drives buttons, banners and the watermark. It is not the lock, and a
// user with devtools can make this file say anything they like. The real
// rules are two Postgres triggers (migration 0030), both SECURITY DEFINER,
// both unreachable from the browser:
//
//   • enforce_estimate_limit  — a free account cannot insert a 2nd proposal
//   • enforce_send_gate       — a free account cannot move any proposal to
//                               sent / approved / in_progress / completed
//
// Both call has_active_subscription(), the ONE predicate that decides who is
// paid up, so the two gates and this module can never disagree.
//
// HUB-READY: `plan` is a column today, set by the Stripe webhook. If a
// central BCG identity+billing hub lands later it just becomes the thing
// that sets `plan` — the gates stay here.

import { supabase } from '@/lib/supabase'

export type Plan = 'free' | 'pro' | 'pro_ai'

/**
 * Stripe subscription status, stored verbatim. NULL means no Stripe record
 * at all — a manually granted plan (founder, comped account), which is
 * honoured rather than treated as lapsed.
 */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | null

/**
 * Statuses that still grant access. past_due is included deliberately:
 * Stripe retries a failed card for days, and cutting a paying contractor
 * off mid-job over a temporary decline costs more than the few days of
 * access it saves. Access ends where Stripe itself has given up.
 *
 * MUST match has_active_subscription() in migration 0030.
 */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

/** The free trial: one proposal, ever. Not per month. */
export const FREE_PROPOSAL_LIMIT = 1

export interface Entitlements {
  plan: Plan
  /** Stripe's status verbatim; null = granted outside Stripe. */
  subscriptionStatus: SubscriptionStatus
  /** When the current paid period ends. null when there is no subscription. */
  currentPeriodEnd: string | null
  /** The one predicate everything else derives from. */
  subscribed: boolean
  /** AI (Jamie) tier. Requires an ACTIVE pro_ai subscription. */
  jamieEnabled: boolean
  /** Proposals this account has ever created — the free trial's meter. */
  proposalsEverCreated: number
  /** null = unlimited (subscribed). */
  proposalLimit: number | null
  canCreateProposal: boolean
  /** False on the free trial: the proposal can be built, never sent. */
  canSendProposal: boolean
  /** True when every print of this account's proposals carries PREVIEW. */
  watermarked: boolean
  /**
   * True once the free trial has been spent — they have their one proposal
   * and cannot make another. The moment to ask for the card.
   */
  trialUsed: boolean
}

/** Lifetime count, not monthly — RLS already scopes this to the caller. */
async function countProposalsEverCreated(): Promise<number> {
  const { count } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
  return count ?? 0
}

export async function loadEntitlements(): Promise<Entitlements> {
  const [{ data: cs }, everCount] = await Promise.all([
    supabase
      .from('company_settings')
      .select(
        'plan, jamie_enabled, subscription_status, current_period_end'
      )
      .single(),
    countProposalsEverCreated(),
  ])

  const plan = ((cs?.plan as Plan) ?? 'free') as Plan
  const subscriptionStatus = (cs?.subscription_status ??
    null) as SubscriptionStatus

  // Mirrors has_active_subscription(): a non-free plan whose status is
  // either entitled or absent entirely (manually granted).
  const subscribed =
    plan !== 'free' &&
    ENTITLED_STATUSES.has(subscriptionStatus ?? 'active')

  return {
    plan,
    subscriptionStatus,
    currentPeriodEnd: (cs?.current_period_end as string | null) ?? null,
    subscribed,
    // A lapsed pro_ai account loses Jamie with everything else — the
    // jamie_enabled column alone is not enough.
    jamieEnabled: subscribed && !!cs?.jamie_enabled,
    proposalsEverCreated: everCount,
    proposalLimit: subscribed ? null : FREE_PROPOSAL_LIMIT,
    canCreateProposal: subscribed || everCount < FREE_PROPOSAL_LIMIT,
    canSendProposal: subscribed,
    watermarked: !subscribed,
    trialUsed: !subscribed && everCount >= FREE_PROPOSAL_LIMIT,
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Server error translation
 *
 * The triggers raise bare codes so they read the same in logs whatever
 * the UI is doing. These turn them into the sentence a contractor sees.
 * ──────────────────────────────────────────────────────────────────── */

/** The free trial's one proposal is already used. */
export function isFreeProposalUsedError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('free_proposal_used') ||
      // 0018's code, still possible from a stale cached function.
      err.message.includes('estimate_limit_reached'))
  )
}

/** Tried to send / approve a proposal without an active subscription. */
export function isSendGateError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('subscription_required_to_send')
  )
}

/**
 * A contractor-readable sentence for either gate, or null when the error
 * is something else entirely and should surface on its own terms.
 */
export function subscriptionErrorMessage(err: unknown): string | null {
  if (isFreeProposalUsedError(err)) {
    return 'That was your free proposal. Subscribe to build more.'
  }
  if (isSendGateError(err)) {
    return 'Subscribe to send proposals. You can keep building and previewing this one.'
  }
  return null
}
