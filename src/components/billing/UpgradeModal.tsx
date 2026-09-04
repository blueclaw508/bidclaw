import { useEffect, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import {
  loadPricing,
  startCheckout,
  type BillingInterval,
  type TierPricing,
} from '@/lib/billing'
import type { Plan } from '@/lib/entitlements'

/**
 * Upgrade / pricing modal. Shown when the free trial's one proposal is
 * spent, when the send gate refuses a transition, or from a plan badge.
 *
 * PRICES ARE STILL HARDCODED HERE. They should come from
 * subscription_tier_limits (which already carries monthly_price_usd and
 * stripe_price_id), so changing a plan is a data edit rather than a deploy.
 * That swap lands with the real numbers + Stripe checkout — doing it twice
 * would mean writing the fetch against prices that are about to change.
 */

interface Tier {
  id: Plan
  name: string
  monthly: string
  yearly: string
  save?: string
  blurb: string
  features: string[]
  accent: 'gray' | 'navy' | 'gold'
  highlight?: boolean
}

const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free trial',
    monthly: '$0',
    yearly: '',
    blurb: 'One proposal, on us',
    features: [
      'One proposal — build it start to finish',
      'Manual estimating (KYN)',
      'Prints watermarked PREVIEW',
      'Cannot be sent until you subscribe',
    ],
    accent: 'gray',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: '$39/mo',
    yearly: '$399/yr',
    save: 'save $69',
    blurb: 'Unlimited estimates',
    features: [
      'Unlimited proposals',
      'Send proposals — no watermark',
      'Kits + catalog',
    ],
    accent: 'navy',
  },
  {
    id: 'pro_ai',
    name: 'Pro + Jamie (AI)',
    monthly: '$499/mo',
    yearly: '$5,588/yr',
    save: 'save $400',
    blurb: 'AI estimating agent',
    features: ['Everything in Pro', 'Jamie builds estimates from a scope', 'KYN takeoff on your catalog + rates'],
    accent: 'gold',
    highlight: true,
  },
]

const ACCENT: Record<Tier['accent'], { ring: string; btn: string; chip: string }> = {
  gray: { ring: 'border-gray-200', btn: 'bg-gray-100 text-gray-500', chip: 'text-gray-500' },
  navy: { ring: 'border-brand-navy/30', btn: 'bg-brand-navy text-white hover:bg-brand-navy-dark', chip: 'text-brand-navy' },
  gold: { ring: 'border-brand-gold', btn: 'bg-brand-gold text-white hover:bg-brand-gold-dark', chip: 'text-brand-gold-dark' },
}

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentPlan: Plan
  /** Optional context line, e.g. "You've used all 5 estimates this month." */
  reason?: string
}

export function UpgradeModal({ open, onClose, currentPlan, reason }: UpgradeModalProps) {
  // Live prices from subscription_tier_limits. The hardcoded TIERS above
  // stay as the FEATURE copy and as the fallback if the fetch fails — a
  // pricing modal that renders blank is worse than one showing last known
  // numbers, but a WRONG price is worse than both, so anything fetched wins.
  const [pricing, setPricing] = useState<TierPricing[] | null>(null)
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    loadPricing()
      .then(setPricing)
      .catch(() => setPricing(null))
  }, [open])

  const priceFor = (id: Plan) => pricing?.find((p) => p.tier === id)

  const go = async (id: Plan) => {
    if (id !== 'pro' && id !== 'pro_ai') return
    setBusy(id)
    try {
      const url = await startCheckout(id, interval)
      // Full navigation, not a new tab: Stripe Checkout in a popup gets
      // blocked, and the return_url brings them straight back to Settings.
      // assign() rather than setting .href — the compiler lint reads a
      // write to a module-scope object as a mutation, and this is a
      // navigation either way.
      window.location.assign(url)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't start checkout."
      )
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upgrade BidClaw"
      description={reason ?? 'Pick the plan that fits how you estimate.'}
      size="2xl"
    >
      {/* Monthly / annual. Rendered only when an annual price actually
          exists in the table — offering a toggle that resolves to nothing
          would dead-end the buyer at checkout. */}
      {pricing?.some((p) => p.purchasableAnnual) && (
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
            {(['monthly', 'annual'] as BillingInterval[]).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors ${
                  interval === iv
                    ? 'bg-brand-navy text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIERS.map((t) => {
          const isCurrent = t.id === currentPlan
          const a = ACCENT[t.accent]
          const live = priceFor(t.id)
          // Only offer what Stripe can actually sell right now.
          const sellable =
            t.id !== 'free' &&
            !!live &&
            (interval === 'annual'
              ? live.purchasableAnnual
              : live.purchasableMonthly)
          return (
            <div
              key={t.id}
              className={`relative flex flex-col rounded-xl border-2 bg-white p-4 ${a.ring} ${
                t.highlight ? 'shadow-md' : ''
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  <Sparkles className="h-3 w-3" /> AI
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <h3 className={`text-sm font-bold ${a.chip}`}>{t.name}</h3>
                {isCurrent && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-1">
                <span className="text-xl font-extrabold text-gray-900">
                  {live
                    ? interval === 'annual' && live.annualUsd !== null
                      ? `$${live.annualUsd.toLocaleString()}/yr`
                      : live.monthlyUsd === 0
                        ? '$0'
                        : `$${live.monthlyUsd?.toLocaleString()}/mo`
                    : t.monthly}
                </span>
                {/* The other interval, as context. Falls back to the
                    hardcoded copy while pricing is still loading. */}
                {live && interval === 'monthly' && live.annualUsd !== null ? (
                  <span className="ml-1.5 text-xs text-gray-500">
                    or ${live.annualUsd.toLocaleString()}/yr
                    {live.monthlyUsd !== null &&
                      live.monthlyUsd * 12 > live.annualUsd && (
                        <span className="ml-1 font-semibold text-emerald-600">
                          (save $
                          {(
                            live.monthlyUsd * 12 -
                            live.annualUsd
                          ).toLocaleString()}
                          )
                        </span>
                      )}
                  </span>
                ) : !live && t.yearly ? (
                  <span className="ml-1.5 text-xs text-gray-500">
                    or {t.yearly}
                    {t.save && <span className="ml-1 font-semibold text-emerald-600">({t.save})</span>}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{t.blurb}</p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-gray-700">
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.chip}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={isCurrent || t.id === 'free' || !sellable || !!busy}
                onClick={() => void go(t.id)}
                className={`mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-60 ${a.btn}`}
              >
                {busy === t.id && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {isCurrent
                  ? 'Your plan'
                  : t.id === 'free'
                    ? '—'
                    : busy === t.id
                      ? 'Opening checkout…'
                      : !sellable
                        ? 'Coming soon'
                        : t.id === 'pro_ai'
                          ? 'Upgrade to Pro + AI'
                          : 'Upgrade to Pro'}
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-gray-400">
        Prices in USD. Annual billed yearly. Questions? ian@blueclawgroup.com
      </p>
    </Modal>
  )
}

export default UpgradeModal
