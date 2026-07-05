import { Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import type { Plan } from '@/lib/entitlements'

/**
 * Upgrade / pricing modal. Shown when a free user hits the 5-estimate
 * monthly cap, or from a plan badge. Prices are the canonical BCG table
 * (blueclaw-app-pricing). Checkout is not wired yet (billing source is
 * pending the central-hub decision) — the CTA is an interim placeholder.
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
    name: 'Free',
    monthly: '$0',
    yearly: '',
    blurb: '5 estimates a month',
    features: ['5 estimates / month', 'Manual estimating (KYN)', 'Proposals + PDF (Detailed / Summary / Crew)'],
    accent: 'gray',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: '$39/mo',
    yearly: '$399/yr',
    save: 'save $69',
    blurb: 'Unlimited estimates',
    features: ['Unlimited estimates', 'Everything in Free', 'Kits + catalog'],
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upgrade BidClaw"
      description={reason ?? 'Pick the plan that fits how you estimate.'}
      size="2xl"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIERS.map((t) => {
          const isCurrent = t.id === currentPlan
          const a = ACCENT[t.accent]
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
                <span className="text-xl font-extrabold text-gray-900">{t.monthly}</span>
                {t.yearly && (
                  <span className="ml-1.5 text-xs text-gray-500">
                    or {t.yearly}
                    {t.save && <span className="ml-1 font-semibold text-emerald-600">({t.save})</span>}
                  </span>
                )}
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
                disabled={isCurrent || t.id === 'free'}
                onClick={() =>
                  toast('Checkout is being set up — you’ll be able to upgrade here shortly.', {
                    icon: '✨',
                  })
                }
                className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-60 ${a.btn}`}
              >
                {isCurrent
                  ? 'Your plan'
                  : t.id === 'free'
                    ? '—'
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
