import { useAuth } from '@/contexts/AuthContext'

function SettingsSection({
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
      {children && <div className="mt-4 text-sm text-brand-text-muted">{children}</div>}
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
          Account, subscription, and integrations.
        </p>
      </header>

      <div className="space-y-4">
        <SettingsSection
          title="Account"
          description="Profile and sign-in details."
        >
          <div className="space-y-1">
            <div>
              <span className="font-medium text-brand-text">Email:</span>{' '}
              {user?.email ?? '—'}
            </div>
            <div className="text-xs italic text-brand-text-muted">
              Full profile editing arrives in Prompt 2.
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Subscription"
          description="Your BidClaw plan."
        >
          Plan management arrives in a later phase.
        </SettingsSection>

        <SettingsSection
          title="QuickBooks Integration"
          description="Map BidClaw item categories to QuickBooks Online accounts."
        >
          QBO sync arrives in Phase 3.
        </SettingsSection>
      </div>
    </div>
  )
}
