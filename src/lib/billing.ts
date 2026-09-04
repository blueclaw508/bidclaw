// Billing client — the browser half of Stripe checkout.
//
// Deliberately thin. It names a TIER and an INTERVAL; the edge function
// resolves the actual Stripe Price from subscription_tier_limits. If this
// module could name a price id, a user who edited it in devtools could
// subscribe themselves to any price in the account, including a $0 one.

import { supabase } from '@/lib/supabase'
import type { Plan } from '@/lib/entitlements'

export type BillingInterval = 'monthly' | 'annual'

/** A purchasable tier. 'free' is the trial; 'founder' is granted by hand. */
export type PurchasableTier = Extract<Plan, 'pro' | 'pro_ai'>

/** One row of the pricing table, as the UI needs it. */
export interface TierPricing {
  tier: string
  displayName: string
  monthlyUsd: number | null
  annualUsd: number | null
  /** False when no Stripe price is configured — the CTA must not offer it. */
  purchasableMonthly: boolean
  purchasableAnnual: boolean
  jamieEstimates: number | null
}

/**
 * Live pricing from subscription_tier_limits, so changing a price is a data
 * edit rather than a deploy. Price IDs themselves are never selected — the
 * UI only needs to know WHETHER one exists, and the ids are not the
 * browser's business.
 */
export async function loadPricing(): Promise<TierPricing[]> {
  const { data, error } = await supabase
    .from('subscription_tier_limits')
    .select(
      'tier, display_name, monthly_price_usd, annual_price_usd, stripe_price_id_monthly, stripe_price_id_annual, monthly_jamie_estimates'
    )
    .in('tier', ['free', 'pro', 'pro_ai'])
  if (error) throw new Error(`Couldn't load plans: ${error.message}`)
  const order: Record<string, number> = { free: 0, pro: 1, pro_ai: 2 }
  return (data ?? [])
    .map((r) => ({
      tier: r.tier as string,
      displayName: (r.display_name as string) ?? r.tier,
      monthlyUsd:
        r.monthly_price_usd === null ? null : Number(r.monthly_price_usd),
      annualUsd:
        r.annual_price_usd === null ? null : Number(r.annual_price_usd),
      purchasableMonthly: !!r.stripe_price_id_monthly,
      purchasableAnnual: !!r.stripe_price_id_annual,
      jamieEstimates:
        r.monthly_jamie_estimates === null
          ? null
          : Number(r.monthly_jamie_estimates),
    }))
    .sort((a, b) => (order[a.tier] ?? 9) - (order[b.tier] ?? 9))
}

/**
 * Start checkout. Returns the Stripe-hosted URL to send the browser to.
 * Throws with a readable message — the caller surfaces it on the button.
 */
export async function startCheckout(
  tier: PurchasableTier,
  interval: BillingInterval
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { tier, interval },
  })
  if (error) {
    throw new Error(
      error instanceof Error ? error.message : "Couldn't start checkout."
    )
  }
  const url = (data as { url?: string } | null)?.url
  if (!url) throw new Error("Stripe didn't return a checkout link.")
  return url
}
