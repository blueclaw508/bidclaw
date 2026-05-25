import { Link } from 'react-router-dom'
import { Building2, Calculator, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

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
      className="group flex items-start gap-4 rounded-xl border border-brand-border bg-white p-5 shadow-sm transition-colors hover:border-brand-navy/40 hover:bg-brand-surface"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-brand-text">{title}</h2>
        <p className="mt-1 text-xs text-brand-text-muted">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-brand-text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-navy" />
    </Link>
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
    <section className="rounded-xl border border-brand-border bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold tracking-tight text-brand-text">
        {title}
      </h2>
      <p className="mt-1 text-sm text-brand-text-muted">{description}</p>
      {children && (
        <div className="mt-4 text-sm text-brand-text-muted">{children}</div>
      )}
    </section>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
          Settings
        </h1>
        <p className="mt-1 text-sm text-brand-text-muted">
          Company profile, pricing fundamentals, and integrations.
        </p>
      </header>

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
              <span className="font-medium text-brand-text">Email:</span>{' '}
              {user?.email ?? '—'}
            </div>
            <div className="text-xs italic text-brand-text-muted">
              Full profile editing arrives in a later phase.
            </div>
          </div>
        </InfoSection>

        <InfoSection title="Subscription" description="Your BidClaw plan.">
          Plan management arrives with tier-gating + Stripe billing.
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
