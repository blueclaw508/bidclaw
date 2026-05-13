import { useState, useCallback, useRef, useEffect } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PromoScreen } from '@/components/PromoScreen'
import UpgradeModal from '@/components/UpgradeModal'
import { JamieErrorModal } from '@/components/JamieErrorModal'
import type { JamieErrorType } from '@/components/JamieErrorModal'
import { classifyJamieError } from '@/lib/jamieErrors'
import NavBar from '@/components/NavBar'
import { Footer } from '@/components/Footer'
import CompanyInfo from '@/components/settings/CompanyInfo'
import ItemCatalog from '@/components/settings/ItemCatalog'
import ProductionRates from '@/components/settings/ProductionRates'
import AboutKYN from '@/components/settings/AboutKYN'
import { EstimateDashboard } from '@/components/estimate/EstimateDashboard'

// v3 screens
import { Screen1Upload } from '@/components/estimate/Screen1Upload'
import { Screen2Findings } from '@/components/estimate/Screen2Findings'
import { Step3ReviewV2, type CustomerInfo } from '@/components/estimate/Step3ReviewV2'

// V2 engine hook
import { useEstimateV2 } from '@/hooks/useEstimateV2'
// pass2V2 types used internally by the hook

import { Loader2, Cloud, Check, Lock, Clock } from 'lucide-react'

type Tab = 'company-info' | 'item-catalog' | 'production-rates' | 'about-kyn' | 'estimates'

const LS_ESTIMATE_ID = 'bidclaw_active_estimate_id'

function AppContent() {
  const { user, hasQCAccount, canAccessBidClaw, bidclawAccessLevel, trialDaysLeft, subscriptionTier, loading: authLoading } = useAuth()
  const [currentTab, setCurrentTab] = useState<Tab>('estimates')
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_ESTIMATE_ID) } catch { return null }
  })
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [jamieErrorOpen, setJamieErrorOpen] = useState(false)
  const [jamieErrorType, setJamieErrorType] = useState<JamieErrorType>('snag')
  const lastRetryAction = useRef<(() => void) | null>(null)

  const showJamieError = useCallback((errorMsg: string, retryAction?: () => void) => {
    setJamieErrorType(classifyJamieError(errorMsg))
    lastRetryAction.current = retryAction ?? null
    setJamieErrorOpen(true)
  }, [])

  // Persist activeEstimateId
  useEffect(() => {
    try {
      if (activeEstimateId) localStorage.setItem(LS_ESTIMATE_ID, activeEstimateId)
      else localStorage.removeItem(LS_ESTIMATE_ID)
    } catch {}
  }, [activeEstimateId])

  // V2 hook
  const v2 = useEstimateV2(activeEstimateId ?? undefined, (msg) => showJamieError(msg))

  // Clear stale localStorage when estimate not found
  useEffect(() => {
    if (v2.notFound && activeEstimateId) {
      try { localStorage.removeItem(LS_ESTIMATE_ID) } catch {}
      setActiveEstimateId(null)
    }
  }, [v2.notFound, activeEstimateId])

  // Reset — returns to dashboard
  const resetEstimateState = useCallback(() => {
    try { localStorage.removeItem(LS_ESTIMATE_ID) } catch {}
    setActiveEstimateId(null)
  }, [])

  // ── Customer info state (lives here so it persists across screens) ──
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    first_name: '', last_name: '', company_name: '', phone: '', email: '',
    estimate_name: '', address_line: '', city: '', state: '', zip: '',
  })
  const customerInfoSynced = useRef(false)

  // Sync customer info from estimate + pass1 client_info_found
  useEffect(() => {
    if (!v2.estimate || customerInfoSynced.current) return
    customerInfoSynced.current = true

    const est = v2.estimate
    const clientInfo = est.pass1_extraction?.client_info_found

    setCustomerInfo({
      first_name: est.first_name || '',
      last_name: est.last_name || '',
      company_name: est.company_name || '',
      phone: est.phone || '',
      email: est.email || '',
      estimate_name: est.estimate_name || clientInfo?.project_name || '',
      address_line: est.address_line || clientInfo?.address || '',
      city: est.city || clientInfo?.city || '',
      state: est.state || clientInfo?.state || '',
      zip: est.zip || '',
    })
  }, [v2.estimate])

  // Reset sync flag when estimate changes
  useEffect(() => {
    customerInfoSynced.current = false
  }, [activeEstimateId])

  const handleCustomerInfoChange = useCallback((updates: Partial<CustomerInfo>) => {
    setCustomerInfo(prev => ({ ...prev, ...updates }))
    // Debounced save to DB
    v2.updateEstimate(updates as Record<string, unknown>)
  }, [v2])

  // ── Catalog items for Step3 ──
  const [catalogItems, setCatalogItems] = useState<import('@/lib/types').CatalogItem[]>([])
  useEffect(() => {
    if (!user) return
    import('@/lib/supabase').then(({ supabase }) => {
      supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).then(({ data }) => {
        if (data) setCatalogItems(data as import('@/lib/types').CatalogItem[])
      })
    })
  }, [user])

  // ── Screen 1: Send to Jamie ──
  const handleSendToJamie = useCallback(async (
    files: File[],
    userContext: string,
    fields: { estimateName: string; firstName: string; lastName: string; address: string; city: string; state: string; zip: string }
  ) => {
    let estId = activeEstimateId

    // Create estimate if needed
    if (!estId) {
      estId = await v2.createEstimate()
      if (!estId) { showJamieError('Could not create estimate'); return }
      setActiveEstimateId(estId)
      // Wait for hook to load the new estimate
      await new Promise(r => setTimeout(r, 500))
    }

    // Save quick-entry fields + user context to the estimate
    const fieldUpdates: Record<string, unknown> = {}
    if (fields.estimateName) fieldUpdates.estimate_name = fields.estimateName
    if (fields.firstName) fieldUpdates.first_name = fields.firstName
    if (fields.lastName) fieldUpdates.last_name = fields.lastName
    if (fields.address) fieldUpdates.address_line = fields.address
    if (fields.city) fieldUpdates.city = fields.city
    if (fields.state) fieldUpdates.state = fields.state
    if (fields.zip) fieldUpdates.zip = fields.zip
    if (userContext) fieldUpdates.project_description = userContext
    if (Object.keys(fieldUpdates).length > 0) {
      v2.updateEstimate(fieldUpdates as Record<string, unknown>, true)
    }

    // Sync customerInfo state so Screen 3 pre-fills
    setCustomerInfo(prev => ({
      ...prev,
      ...(fields.firstName ? { first_name: fields.firstName } : {}),
      ...(fields.lastName ? { last_name: fields.lastName } : {}),
      ...(fields.address ? { address_line: fields.address } : {}),
      ...(fields.city ? { city: fields.city } : {}),
      ...(fields.state ? { state: fields.state } : {}),
      ...(fields.zip ? { zip: fields.zip } : {}),
      ...(fields.estimateName ? { estimate_name: fields.estimateName } : {}),
    }))

    // Upload files
    for (const file of files) {
      await v2.uploadPlan(file)
    }

    // Run Pass 1
    await v2.runPass1()
  }, [activeEstimateId, v2, showJamieError])

  // ── Screen 2: Estimate work areas ──
  const handleEstimateWorkAreas = useCallback(async (
    selectedWorkAreas: { name: string; summary: string }[],
    questionAnswers: { question: string; answer: string }[]
  ) => {
    if (!v2.estimate) return

    // Create work areas in DB
    for (const wa of selectedWorkAreas) {
      await v2.addWorkArea(wa.name)
    }

    // Save question answers to estimate description for context
    if (questionAnswers.length > 0) {
      const existingDesc = v2.estimate.project_description || ''
      const answersText = questionAnswers.map(qa => `${qa.question} → ${qa.answer}`).join('\n')
      const newDesc = existingDesc
        ? `${existingDesc}\n\nContractor answers:\n${answersText}`
        : `Contractor answers:\n${answersText}`
      v2.updateEstimate({ project_description: newDesc }, true)
    }

    // Run Pass 2
    await v2.runPass2()
  }, [v2])

  // ── Auth gates ──

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c1428]">
        <Loader2 className="animate-spin text-blue-400" size={32} />
      </div>
    )
  }

  if (!user) return <PromoScreen />

  if (!hasQCAccount) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-4 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="mx-auto mb-4 h-12 w-12 rounded-lg object-contain" />
          <h2 className="mb-2 text-xl font-bold text-gray-900">QuickCalc Account Required</h2>
          <p className="mb-6 text-sm text-gray-500">
            BidClaw requires a QuickCalc account. Visit{' '}
            <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:text-blue-800 underline">bluequickcalc.app</a>{' '}to get started.
          </p>
          <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            Go to QuickCalc
          </a>
        </div>
      </div>
    )
  }

  if (subscriptionTier === 'free' && bidclawAccessLevel === 'none') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-4 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="mx-auto mb-4 h-12 w-12 rounded-lg object-contain" />
          <h2 className="mb-2 text-xl font-bold text-gray-900">Pro Subscription Required</h2>
          <p className="mb-6 text-sm text-gray-500">
            BidClaw is available exclusively to QuickCalc Pro subscribers. Upgrade your QuickCalc plan to unlock a free 7-day trial of BidClaw.
          </p>
          <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            Upgrade QuickCalc to Pro
          </a>
        </div>
      </div>
    )
  }

  if (bidclawAccessLevel === 'trial_expired') {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="mx-4 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <Lock className="mx-auto mb-4 text-gray-400" size={40} />
            <h2 className="mb-2 text-xl font-bold text-gray-900">Free Trial Expired</h2>
            <p className="mb-6 text-sm text-gray-500">
              Your 7-day BidClaw trial has ended. Upgrade to BidClaw for $599 to unlock full access — including pushing estimates directly to QuickCalc.
            </p>
            <button onClick={() => setShowUpgrade(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">
              Upgrade to BidClaw — $599
            </button>
          </div>
        </div>
        <UpgradeModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
      </>
    )
  }

  if (!canAccessBidClaw) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to BidClaw</h2>
            <p className="text-gray-500 mb-4">Your account needs a BidClaw subscription to continue.</p>
            <button onClick={() => setShowUpgrade(true)}
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">
              Upgrade to BidClaw
            </button>
          </div>
        </div>
        <UpgradeModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
      </>
    )
  }

  // ══════════════════════════════════════════════════════
  // v3 Guided Agentic Flow
  // ══════════════════════════════════════════════════════

  if (activeEstimateId) {
    // Determine which screen to show based on estimate state
    const est = v2.estimate
    const hasPass1 = !!est?.pass1_extraction
    const hasPass2 = v2.workAreas.some(wa => wa.pass2_completed_at !== null)
    const isReview = hasPass2 || est?.status === 'review' || est?.status === 'sent' || est?.status === 'exported'

    // Which screen?
    // Screen 1: No pass1 yet (or loading)
    // Screen 2: Pass 1 done, no pass 2 yet
    // Screen 3: Pass 2 done (review mode)
    let screen: 1 | 2 | 3 = 1
    if (isReview) screen = 3
    else if (hasPass1) screen = 2

    return (
      <div className="min-h-screen bg-gray-50">
        {/* Trial banner */}
        {bidclawAccessLevel === 'trial' && (
          <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm">
            <Clock size={14} className="text-amber-600" />
            <span className="text-amber-800">
              <span className="font-semibold">Free Trial</span> — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining.
              Push to QuickCalc requires a paid subscription.
            </span>
            <button onClick={() => setShowUpgrade(true)}
              className="ml-2 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700">
              Upgrade
            </button>
          </div>
        )}

        {/* Top bar */}
        <div className={`sticky ${bidclawAccessLevel === 'trial' ? 'top-[41px]' : 'top-0'} z-30 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3`}>
          <div className="flex items-center gap-3">
            <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-semibold text-gray-900">BidClaw</span>
          </div>
          <div className="flex items-center gap-3">
            {v2.saving && <span className="flex items-center gap-1 text-xs text-gray-400"><Cloud size={14} /> Saving...</span>}
            {!v2.saving && <span className="flex items-center gap-1 text-xs text-green-600"><Check size={14} /> Saved</span>}
            <button onClick={resetEstimateState}
              className="text-sm text-gray-500 hover:text-gray-900">Exit</button>
          </div>
        </div>

        <JamieErrorModal
          isOpen={jamieErrorOpen}
          type={jamieErrorType}
          onClose={() => setJamieErrorOpen(false)}
          onRetry={lastRetryAction.current ?? undefined}
        />

        <div className="mx-auto max-w-5xl p-6">
          {v2.loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
          ) : screen === 1 ? (
            <Screen1Upload
              onSendToJamie={handleSendToJamie}
              pass1Loading={v2.pass1Loading}
              existingPlans={(est?.plans ?? []).map(p => ({ file_name: p.file_name, page_count: p.page_count }))}
              initialFields={{
                estimateName: est?.estimate_name ?? '',
                firstName: est?.first_name ?? '',
                lastName: est?.last_name ?? '',
                address: est?.address_line ?? '',
                city: est?.city ?? '',
                state: est?.state ?? '',
                zip: est?.zip ?? '',
              }}
              onBack={resetEstimateState}
            />
          ) : screen === 2 ? (
            <Screen2Findings
              pass1Extraction={est!.pass1_extraction!}
              pass2Loading={v2.pass2Loading}
              pass2Progress={v2.pass2Progress}
              pass2Error={v2.pass2Error}
              onEstimate={handleEstimateWorkAreas}
              onBack={() => {
                // Navigate back to Screen 1 — clear pass1 to re-show upload
                v2.updateEstimate({
                  pass1_extraction: null,
                  pass1_confidence: null,
                  pass1_completed_at: null,
                  status: 'draft',
                } as Record<string, unknown>, true)
              }}
            />
          ) : (
            <Step3ReviewV2
              workAreas={v2.workAreas}
              lineItems={v2.lineItems}
              catalogItems={catalogItems}
              onUpdateScope={(waId, scope) => v2.updateWorkAreaScope(waId, scope)}
              onAddItem={(waId, item) => v2.addLineItem(waId, item)}
              onUpdateItem={(id, updates) => v2.updateLineItem(id, updates)}
              onRemoveItem={(id, waId) => v2.removeLineItem(id, waId)}
              onBack={() => {
                // Back to Findings — clear pass2 data from work areas
                v2.updateEstimate({ status: 'pass1_complete' } as Record<string, unknown>, true)
              }}
              customerInfo={customerInfo}
              onCustomerInfoChange={handleCustomerInfoChange}
              clientInfoFound={est?.pass1_extraction?.client_info_found}
              onSendToQuickCalc={async () => {
                // Save customer info immediately before sending
                await v2.updateEstimate(customerInfo as unknown as Record<string, unknown>, true)
                return v2.sendToQuickCalc()
              }}
              onExportExcel={async () => {
                // Save customer info immediately before export
                await v2.updateEstimate(customerInfo as unknown as Record<string, unknown>, true)
                return v2.exportToExcel()
              }}
              isTrial={bidclawAccessLevel === 'trial'}
              onUpgrade={() => setShowUpgrade(true)}
            />
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════
  // Main app with nav (no active estimate)
  // ══════════════════════════════════════════════════════

  return (
    <div className="flex min-h-screen flex-col">
      {bidclawAccessLevel === 'trial' && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm">
          <Clock size={14} className="text-amber-600" />
          <span className="text-amber-800">
            <span className="font-semibold">Free Trial</span> — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining.
          </span>
          <button onClick={() => setShowUpgrade(true)}
            className="ml-2 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700">
            Upgrade
          </button>
        </div>
      )}
      <NavBar currentTab={currentTab} onTabChange={(tab: string) => setCurrentTab(tab as Tab)} />
      <div className="flex flex-1">
        {/* Left sidebar — Jamie */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col items-center bg-gradient-to-b from-slate-50 to-white border-r border-slate-200 px-4 py-8">
          <div className="sticky top-20">
            <img
              src="/jamie-avatar.png"
              alt="Jamie"
              className="w-72 rounded-2xl opacity-90 shadow-xl"
            />
          </div>
        </aside>

        <main className="flex-1 bg-gray-50">
          <div className="mx-auto max-w-6xl p-6">
            {currentTab === 'company-info' && <CompanyInfo />}
            {currentTab === 'item-catalog' && <ItemCatalog />}
            {currentTab === 'production-rates' && <ProductionRates />}
            {currentTab === 'about-kyn' && <AboutKYN />}
            {currentTab === 'estimates' && (
              <EstimateDashboard
                onNewEstimate={async () => {
                  try {
                    const id = await v2.createEstimate()
                    if (id) {
                      setActiveEstimateId(id)
                    } else {
                      console.error('[App] createEstimate returned null — likely auth session issue')
                    }
                  } catch (err) {
                    console.error('[App] createEstimate threw:', err)
                  }
                }}
                onOpenEstimate={(id: string) => setActiveEstimateId(id)}
              />
            )}
          </div>
        </main>
      </div>
      <Footer />
      <JamieErrorModal
        isOpen={jamieErrorOpen}
        type={jamieErrorType}
        onClose={() => setJamieErrorOpen(false)}
        onRetry={lastRetryAction.current ?? undefined}
      />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  )
}
