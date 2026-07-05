// BidClaw entitlements — the plan gate (paywall).
//
// Tiers: free (5 estimates/mo, no AI) · pro ($39, unlimited, no AI) ·
// pro_ai ($499, unlimited + Jamie). The "estimate" meter = proposals
// created this calendar month. Server-side enforcement is a trigger
// (migration 0018) — this module is the client-side read + the upgrade
// prompt driver, NOT the source of truth.
//
// HUB-READY: `plan` is a single column today (set by admin / migration).
// If a central BCG identity+billing hub lands later, it just becomes the
// thing that sets `plan` — the gate and meter stay here.

import { supabase } from '@/lib/supabase'

export type Plan = 'free' | 'pro' | 'pro_ai'

/** Free plan: 5 sendable estimates (proposals) per calendar month. */
export const FREE_ESTIMATE_LIMIT = 5

export interface Entitlements {
  plan: Plan
  /** AI (Jamie) tier. True only on pro_ai. */
  jamieEnabled: boolean
  estimatesThisMonth: number
  /** null = unlimited (paid plans). */
  estimateLimit: number | null
  canCreateEstimate: boolean
}

/** First-of-month in UTC — matches the trigger's date_trunc('month', now()). */
function monthStartUTC(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

async function countEstimatesThisMonth(): Promise<number> {
  const { count } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStartUTC())
  return count ?? 0
}

export async function loadEntitlements(): Promise<Entitlements> {
  const [{ data: cs }, monthCount] = await Promise.all([
    supabase.from('company_settings').select('plan, jamie_enabled').single(),
    countEstimatesThisMonth(),
  ])
  const plan = ((cs?.plan as Plan) ?? 'free') as Plan
  const estimateLimit = plan === 'free' ? FREE_ESTIMATE_LIMIT : null
  return {
    plan,
    jamieEnabled: !!cs?.jamie_enabled,
    estimatesThisMonth: monthCount,
    estimateLimit,
    canCreateEstimate: estimateLimit === null || monthCount < estimateLimit,
  }
}

/** True when an insert was rejected by the free-tier estimate gate. */
export function isEstimateLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('estimate_limit_reached')
}
