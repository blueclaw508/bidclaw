import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  Inbox,
  Users,
  BookOpen,
  Wrench,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSetup } from '@/contexts/SetupContext'
import { MarketingBar } from '@/components/MarketingBar'
import { SetupBanner } from '@/components/setup/SetupBanner'
import { cn } from '@/lib/utils'

// Lazy-load the setup wizard — it's ~34 kB and only mounts when
// setup is incomplete (first-login auto-open or ?wizard=1 trigger).
// Pull it out of the main bundle to keep the /app/* shell fast.
const WizardModal = lazy(() =>
  import('@/components/setup/WizardModal').then((m) => ({ default: m.WizardModal }))
)

const navItems = [
  // Leads & Bids is the front door (LOOP.md P1-B) — first in nav.
  { to: '/app/leads',     label: 'Leads & Bids', icon: Inbox },
  { to: '/app/projects',  label: 'Estimates', icon: ClipboardList },
  { to: '/app/customers', label: 'Customers', icon: Users },
  { to: '/app/catalog',   label: 'Catalog',   icon: BookOpen },
  { to: '/app/kits',      label: 'Kits',      icon: Wrench },
  { to: '/app/settings',  label: 'Settings',  icon: SettingsIcon },
]

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // Wizard control hoisted to SetupContext (Phase 4) so useSetupGate
  // + first-login auto-open + ?wizard=1 query-param trigger can all
  // request the wizard without prop-drilling.
  const { loading: setupLoading, setupCompleted, wizardOpen, openWizard, closeWizard } = useSetup()

  // Phase 4 — first-login auto-open. Fires once per session per user
  // when authenticated AND setup is incomplete. Subsequent renders in
  // the same tab respect the sessionStorage trip flag so the wizard
  // doesn't re-open on every page navigation.
  useEffect(() => {
    if (setupLoading) return
    if (!user) return
    if (setupCompleted) return
    const flagKey = `setup_wizard_auto_opened_${user.id}`
    if (sessionStorage.getItem(flagKey) === '1') return
    sessionStorage.setItem(flagKey, '1')
    openWizard()
  }, [setupLoading, user, setupCompleted, openWizard])

  // Debug trigger — manual ?wizard=1 query-param override stays as a
  // testing affordance. Bypasses the auto-open trip flag so a tester
  // can re-open the wizard mid-session without clearing
  // sessionStorage. Phase 4 closes Prompt 4 with this still in place.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('wizard') === '1') {
      openWizard()
    }
  }, [searchParams, openWizard])
  const handleWizardClose = useCallback(() => {
    closeWizard()
    if (searchParams.get('wizard') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('wizard')
      setSearchParams(next, { replace: true })
    }
  }, [closeWizard, searchParams, setSearchParams])

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col bg-brand-surface">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-brand-border bg-white">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/app/projects"
            className="flex shrink-0 items-center gap-2.5"
          >
            <img
              src="/bidclaw-logo-sm.png"
              alt="BidClaw"
              className="h-9 w-9 rounded-md object-contain"
            />
            <span className="text-lg font-bold tracking-tight text-brand-navy">
              BidClaw
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-brand-navy/10 text-brand-navy'
                      : 'text-brand-text-muted hover:bg-brand-surface hover:text-brand-text'
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* User menu (desktop) */}
          <div className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-text-muted hover:border-brand-navy/40 hover:text-brand-text"
            >
              <span className="max-w-[180px] truncate">{user?.email ?? 'Signed in'}</span>
            </button>
            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setUserMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border border-brand-border bg-white py-1 shadow-lg">
                  <div className="border-b border-brand-border px-3 py-2 text-xs text-brand-text-muted">
                    {user?.email}
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-brand-text hover:bg-brand-surface"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-brand-border text-brand-text-muted md:hidden"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="border-t border-brand-border bg-white px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
                      isActive
                        ? 'bg-brand-navy/10 text-brand-navy'
                        : 'text-brand-text-muted hover:bg-brand-surface hover:text-brand-text'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
              <div className="mt-2 border-t border-brand-border pt-2">
                <div className="px-3 py-1 text-xs text-brand-text-muted">{user?.email}</div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-text hover:bg-brand-surface"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* SETUP BANNER — amber strip below the sticky header when the
          user hasn't completed setup. Hidden when complete OR when
          dismissed for this session via sessionStorage flag. */}
      <SetupBanner />

      {/* MAIN */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-10 sm:px-6">
          <Outlet />
        </div>
      </main>

      {/* MARKETING BAR */}
      <MarketingBar />

      {/* Setup wizard — Phase 3. Overlay-mounted via portal so it
          appears above everything else in /app/* routes. Lazy-loaded
          (Prompt 4.5) so the ~34 kB wizard bundle doesn't ship with
          the main app shell — only fetched when actually needed. */}
      {wizardOpen && (
        <Suspense fallback={null}>
          <WizardModal open={wizardOpen} onClose={handleWizardClose} />
        </Suspense>
      )}
    </div>
  )
}
