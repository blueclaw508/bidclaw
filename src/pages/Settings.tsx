import { Suspense, lazy, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Calculator, ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { loadEntitlements, type Entitlements } from '@/lib/entitlements'

const UpgradeModal = lazy(() => import('@/components/billing/UpgradeModal'))

/**
 * Settings index. Two clickable nav cards for the Phase 2 settings
 * surfaces (Company Info, Know Your Numbers) plus informational stubs
 * for upcoming integrations.
 */

interface NavCardProps {
  to: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

function NavCard({ to, icon: Icon, title, description }: NavCardProps) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-navy/40 hover:bg-blue-50/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-navy" />
    </Link>
  )
}

/**
 * Live subscription state, replacing the "arrives with Stripe billing"
 * stub. Reads the same entitlement shape the gates use, so what a
 * contractor is told here and what the server actually permits cannot
 * drift apart.
 */
function SubscriptionSummary() {
  const [ent, setEnt] = useState<Entitlements | null>(null)
  const [failed, setFailed] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  useEffect(() => {
    loadEntitlements()
      .then(setEnt)
      .catch(() => setFailed(true))
  }, [])

  if (failed) {
    return <span className="text-gray-500">Couldn&rsquo;t load your plan.</span>
  }
  if (!ent) return <span className="text-gray-400">Loading&hellip;</span>

  const planLabel =
    ent.plan === 'pro_ai' ? 'Pro + Jamie (AI)' : ent.plan === 'pro' ? 'Pro' : 'Free trial'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{planLabel}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
            ent.subscribed
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-amber-50 text-amber-700 ring-amber-300'
          }`}
        >
          {ent.subscribed ? 'Active' : 'Not subscribed'}
        </span>
        {/* past_due still grants access (Stripe is retrying the card), but
            it is the one state worth saying out loud before it lapses. */}
        {ent.subscriptionStatus === 'past_due' && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
            Payment failed — update your card
          </span>
        )}
      </div>

      {ent.subscribed ? (
        <p className="text-gray-600">
          Unlimited proposals, sent without a watermark.
          {ent.currentPeriodEnd
            ? ` Renews ${new Date(ent.currentPeriodEnd).toLocaleDateString()}.`
            : ''}
        </p>
      ) : (
        <p className="text-gray-600">
          {ent.trialUsed
            ? 'Your free proposal has been used. Subscribe to build and send more.'
            : `Your free trial covers ${ent.proposalLimit} proposal. It prints with a PREVIEW watermark and can\u2019t be sent until you subscribe.`}
        </p>
      )}

      {!ent.subscribed && (
        <button
          type="button"
          onClick={() => setUpgradeOpen(true)}
          className="rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy-dark"
        >
          See plans
        </button>
      )}

      {upgradeOpen && (
        <Suspense fallback={null}>
          <UpgradeModal
            open={upgradeOpen}
            onClose={() => setUpgradeOpen(false)}
            currentPlan={ent.plan}
          />
        </Suspense>
      )}
    </div>
  )
}

function InfoSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      {children && (
        <div className="mt-4 text-sm text-gray-600">{children}</div>
      )}
    </section>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6 pb-8">
      {/* Gradient page header — QC blue. */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-lg">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-blue-100 text-sm mt-0.5">
              Company profile, pricing fundamentals, and integrations.
            </p>
          </div>
        </div>
      </div>

      {/* Active settings surfaces */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NavCard
          to="/app/settings/company-profile"
          icon={Building2}
          title="Company Profile"
          description="Identity + contact info — logo, name, address, email, phone, website."
        />
        <NavCard
          to="/app/settings/enter-my-numbers"
          icon={Calculator}
          title="Enter My Numbers"
          description="PDF branding, target billable labor rates, markups, equipment rates, and default Terms & Conditions."
        />
      </div>

      {/* Informational stubs */}
      <div className="space-y-4">
        <InfoSection title="Account" description="Profile and sign-in details.">
          <div className="space-y-1">
            <div>
              <span className="font-medium text-gray-900">Email:</span>{' '}
              {user?.email ?? '—'}
            </div>
            <div className="text-xs italic text-gray-500">
              Full profile editing arrives in a later phase.
            </div>
          </div>
        </InfoSection>

        <InfoSection title="Subscription" description="Your BidClaw plan.">
          <SubscriptionSummary />
        </InfoSection>

        <InfoSection
          title="QuickBooks Integration"
          description="Map BidClaw item categories to QuickBooks Online accounts."
        >
          QBO sync arrives in Phase 3.
        </InfoSection>
      </div>
    </div>
  )
}
