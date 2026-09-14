import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import './workflow-sidebar.css'
import { useAuth } from '@/contexts/AuthContext'
import { useSetup } from '@/contexts/SetupContext'
import { MarketingBar } from '@/components/MarketingBar'
import { SetupBanner } from '@/components/setup/SetupBanner'

// Lazy-load the setup wizard â€” it's ~34 kB and only mounts when
// setup is incomplete (first-login auto-open or ?wizard=1 trigger).
// Pull it out of the main bundle to keep the /app/* shell fast.
const WizardModal = lazy(() =>
  import('@/components/setup/WizardModal').then((m) => ({ default: m.WizardModal }))
)

const navGroups = [
  {label:'Customers & Sales', items:[{to:'/app/customers',label:'Customers'},{to:'/app/leads',label:'Leads & Bids'},{to:'/app/projects',label:'Estimates & Proposals'}]},
  {label:'Daily Work', items:[{to:'/app/work-orders',label:'Work Orders'},{to:'https://crewclaw.netlify.app/records.html',label:'Record the Work'}]},
  {label:'Review & Billing', items:[{to:'/app/crew-review',label:'Review & Finalize'},{to:'/app/wip',label:'Month-end'}]},
  {label:'Setup', items:[{to:'https://crewclaw.netlify.app/setup.html',label:'Crews & Employees'},{to:'/app/catalog',label:'Catalog'},{to:'/app/kits',label:'Kits'},{to:'/app/settings',label:'System Settings'}]},
]

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  // Wizard control hoisted to SetupContext (Phase 4) so useSetupGate
  // + first-login auto-open + ?wizard=1 query-param trigger can all
  // request the wizard without prop-drilling.
  const { loading: setupLoading, setupCompleted, wizardOpen, openWizard, closeWizard } = useSetup()

  // Phase 4 â€” first-login auto-open. Fires once per session per user
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

  // Debug trigger â€” manual ?wizard=1 query-param override stays as a
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
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="app-readable workflow-layout bg-brand-surface">
      <header className="workflow-mobile"><Link to="/app/projects">BidClaw</Link><button type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="workflow-navigation" onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen ? <X/> : <Menu/>}</button></header>
      <aside id="workflow-navigation" className={`workflow-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <Link className="workflow-brand" to="/app/projects" onClick={()=>setMenuOpen(false)}><img src="/bidclaw-logo-sm.png" alt=""/>BidClaw</Link>
        <nav aria-label="Main navigation">{navGroups.map(group=><section key={group.label}><h2>{group.label}</h2>{group.items.map(item=>item.to.startsWith('https:') ? <a key={item.to} href={item.to} target="_blank" rel="noopener noreferrer" onClick={()=>setMenuOpen(false)}>{item.label}<span className="sr-only"> (opens CrewClaw in a new tab)</span> ↗</a> : <NavLink key={item.to} to={item.to} onClick={()=>setMenuOpen(false)}>{item.label}</NavLink>)}</section>)}</nav>
        <a className="workflow-crew" href="https://crewclaw.netlify.app/" target="_blank" rel="noopener noreferrer">CrewClaw ↗</a>
        <div className="workflow-account"><span>{user?.email}</span><button onClick={handleSignOut}>Sign out</button></div>
      </aside>
      <div className="workflow-content"><SetupBanner/><main><div className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6"><Outlet/></div></main><MarketingBar/></div>
      {wizardOpen && <Suspense fallback={null}><WizardModal open={wizardOpen} onClose={handleWizardClose}/></Suspense>}
    </div>
  )
}
