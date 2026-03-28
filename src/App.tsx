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
import { Step1ProjectInfo } from '@/components/estimate/Step1ProjectInfo'
import { Step2WorkAreas } from '@/components/estimate/Step2WorkAreas'
import { Step3LineItems } from '@/components/estimate/Step3LineItems'
import { Step4Send } from '@/components/estimate/Step4Send'
import { useEstimate } from '@/hooks/useEstimate'
import { supabase } from '@/lib/supabase'
import type { WorkAreaData, LineItemData, CatalogItem, ProductionRate, GapQuestion, WorkAreaEstimateMode } from '@/lib/types'
import type { JamieAnalysisResult } from '@/lib/jamie'
import {
  jamieWriteScope,
  jamieGenerateSummary,
  jamieAnalyzeEstimate,
} from '@/lib/jamie'
import { categoryFromCatalogType, unitFromCategory } from '@/lib/catalogMatcher'
import { Loader2, Cloud, Check, Lock, Clock } from 'lucide-react'

type Tab = 'company-info' | 'item-catalog' | 'production-rates' | 'about-kyn' | 'estimates'

// localStorage keys — outside component so they never change reference
const LS_ESTIMATE_ID = 'bidclaw_active_estimate_id'
const lsJamieKey = (id: string) => 'bidclaw_jamie_' + id

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
  // Tracks which estimateId has already had its Jamie state restored in this session
  const jamieRestored = useRef<string | null>(null)

  const showJamieError = useCallback((errorMsg: string, retryAction?: () => void) => {
    setJamieErrorType(classifyJamieError(errorMsg))
    lastRetryAction.current = retryAction ?? null
    setJamieErrorOpen(true)
  }, [])

  // ── Layer 1: persist activeEstimateId so tab-switch never returns user to dashboard ──
  useEffect(() => {
    try {
      if (activeEstimateId) localStorage.setItem(LS_ESTIMATE_ID, activeEstimateId)
      else localStorage.removeItem(LS_ESTIMATE_ID)
    } catch {}
    // Reset the Jamie-restored guard so state CAN be re-restored if the
    // component remounts with the same estimateId (e.g. after a tab switch)
    jamieRestored.current = null
  }, [activeEstimateId])

  const {
    estimate, loading: estLoading, saving, aiLoading, aiMessage, notFound: estNotFound,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass2, reEstimateWorkArea, sendToQuickCalc,
  } = useEstimate(activeEstimateId, showJamieError)

  const workAreas: WorkAreaData[] = estimate?.work_areas ?? []
  const lineItems: Record<string, LineItemData[]> = estimate?.line_items ?? {}
  const newCatalogItems: string[] = estimate?.new_catalog_items_created ?? []

  // ── Layer 1: clear stale localStorage only when DB confirmed estimate is gone ──
  useEffect(() => {
    if (estNotFound && activeEstimateId) {
      try { localStorage.removeItem(LS_ESTIMATE_ID) } catch {}
      setActiveEstimateId(null)
    }
  }, [estNotFound, activeEstimateId])


  // ── Jamie State ──
  const [jamieBuilt, setJamieBuilt] = useState(false)
  const [jamieScopes, setJamieScopes] = useState<Record<string, string>>({})
  const [jamieScopeLoading, setJamieScopeLoading] = useState<string | null>(null)
  const [jamieSummary, setJamieSummary] = useState<string | null>(null)
  const [jamieSummaryLoading, setJamieSummaryLoading] = useState(false)
  const [jamieAnalysis, setJamieAnalysis] = useState<JamieAnalysisResult | null>(null)
  const [jamieAnalysisLoading, setJamieAnalysisLoading] = useState(false)
  // Mode detection & gap questions (Change B)
  const [workAreaModes, setWorkAreaModes] = useState<Record<string, WorkAreaEstimateMode>>({})
  const [structuredGapQuestions, setStructuredGapQuestions] = useState<Record<string, GapQuestion[]>>({})
  const [reEstimateLoading, setReEstimateLoading] = useState(false)
  const [planReferences, setPlanReferences] = useState<Record<string, string[]>>({})
  const [jamieMessages, setJamieMessages] = useState<Record<string, string>>({})


  // ── Layer 2: restore Jamie state once per estimate when it first loads ──
  useEffect(() => {
    if (!estimate || estimate.id === jamieRestored.current) return
    jamieRestored.current = estimate.id
    try {
      const raw = localStorage.getItem(lsJamieKey(estimate.id))
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.jamieBuilt) setJamieBuilt(saved.jamieBuilt)
      if (saved.jamieScopes && Object.keys(saved.jamieScopes).length) setJamieScopes(saved.jamieScopes)
      if (saved.jamieSummary) setJamieSummary(saved.jamieSummary)
      if (saved.jamieAnalysis) setJamieAnalysis(saved.jamieAnalysis)
    } catch {}
    // Also restore scopes from work_areas (DB-persisted)
    if (estimate.work_areas) {
      const dbScopes: Record<string, string> = {}
      for (const wa of estimate.work_areas) {
        if (wa.scope_description) dbScopes[wa.id] = wa.scope_description
      }
      if (Object.keys(dbScopes).length > 0) {
        setJamieScopes(prev => ({ ...dbScopes, ...prev }))
      }
    }
    // Restore mode detection from DB-persisted fields
    if (estimate.work_area_modes) setWorkAreaModes(estimate.work_area_modes)
    if (estimate.structured_gap_questions) setStructuredGapQuestions(estimate.structured_gap_questions)
  }, [estimate])

  // ── Layer 2: write Jamie state to localStorage on every change ──
  useEffect(() => {
    if (!activeEstimateId) return
    try {
      localStorage.setItem(lsJamieKey(activeEstimateId), JSON.stringify({
        jamieBuilt,
        jamieScopes,
        jamieSummary,
        jamieAnalysis,
      }))
    } catch {}
  }, [activeEstimateId, jamieBuilt, jamieScopes, jamieSummary, jamieAnalysis])

  // ── Layer 3: intentional reset — clears localStorage, returns to dashboard ──
  const resetEstimateState = useCallback(() => {
    try {
      if (activeEstimateId) localStorage.removeItem(lsJamieKey(activeEstimateId))
      localStorage.removeItem(LS_ESTIMATE_ID)
    } catch {}
    setActiveEstimateId(null)
    setJamieBuilt(false)
    setJamieScopes({})
    setJamieSummary(null)
    setJamieAnalysis(null)
    setWorkAreaModes({})
    setStructuredGapQuestions({})
    setPlanReferences({})
    setJamieMessages({})
  }, [activeEstimateId])


  // Jamie: write scope for a work area (unified — returns scope + line items)
  const handleJamieWriteScope = useCallback(async (waId: string) => {
    const wa = workAreas.find((w) => w.id === waId)
    if (!wa || !user) return
    setJamieScopeLoading(waId)
    try {
      // Fetch catalog and production rates for unified prompt
      const [{ data: catalogData }, { data: ratesData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
      ])
      const userCatalog = (catalogData ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]

      const result = await jamieWriteScope(
        wa.name,
        lineItems[waId] ?? [],
        userCatalog,
        productionRates,
        estimate?.project_description ?? undefined,
        (estimate?.plan_file_urls?.length ?? 0) > 0,
      )
      // Update both scope AND line items (Prime Directive enforcement)
      setJamieScopes((prev) => ({ ...prev, [waId]: result.scope_description }))
      // Embed scope into work_areas for DB persistence
      const updatedWorkAreas = workAreas.map(w =>
        w.id === waId ? { ...w, scope_description: result.scope_description } : w
      )
      if (result.line_items && result.line_items.length > 0) {
        updateEstimate({
          work_areas: updatedWorkAreas,
          line_items: { ...lineItems, [waId]: result.line_items },
        })
      } else {
        updateEstimate({ work_areas: updatedWorkAreas })
      }
    } catch (err) {
      showJamieError(
        err instanceof Error ? err.message : 'Jamie could not write scope',
        () => handleJamieWriteScope(waId)
      )
    } finally {
      setJamieScopeLoading(null)
    }
  }, [workAreas, lineItems, user, estimate, updateEstimate, showJamieError])

  // Jamie: update scope
  const handleJamieUpdateScope = useCallback((waId: string, scope: string) => {
    setJamieScopes((prev) => ({ ...prev, [waId]: scope }))
  }, [])

  // Jamie: generate estimate summary
  const handleJamieGenerateSummary = useCallback(async () => {
    if (!estimate) return
    setJamieSummaryLoading(true)
    try {
      const summary = await jamieGenerateSummary(
        estimate.client_name ?? '',
        estimate.project_address ?? '',
        workAreas,
        lineItems
      )
      setJamieSummary(summary)
    } catch (err) {
      showJamieError(
        err instanceof Error ? err.message : 'Jamie could not generate summary',
        handleJamieGenerateSummary
      )
    } finally {
      setJamieSummaryLoading(false)
    }
  }, [estimate, workAreas, lineItems, showJamieError])

  // Jamie: analyze estimate (local checks only — no pricing, no catalog-wide audit)
  const handleJamieAnalyze = useCallback(() => {
    setJamieAnalysisLoading(true)
    try {
      const result = jamieAnalyzeEstimate(workAreas, lineItems)
      setJamieAnalysis(result)
    } catch (err) {
      showJamieError(
        err instanceof Error ? err.message : 'Jamie analysis failed'
      )
    } finally {
      setJamieAnalysisLoading(false)
    }
  }, [workAreas, lineItems, showJamieError])

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

  // Not a Pro subscriber — no trial, must upgrade QC first
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

  // Trial expired — block access, show upgrade
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

  // Pro user with no trial yet and no paid access (shouldn't normally happen — auto-start covers it)
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

  // Estimate workflow (full screen when active)
  if (activeEstimateId && estimate) {
    const step = estimate.workflow_step

    const handleGenerate = async (data: {
      client_name: string; project_name?: string | null;
      project_address: string; project_description: string; files: File[]
    }) => {
      try {
        const urls = data.files.length > 0 ? await uploadFiles(data.files) : estimate.plan_file_urls
        updateEstimate({
          client_name: data.client_name,
          project_name: data.project_name ?? null,
          project_address: data.project_address,
          project_description: data.project_description,
          plan_file_urls: urls,
          workflow_step: 2,
        }, true)
      } catch {
        showJamieError('Jamie hit a snag — couldn\'t process your project files. Try again.')
      }
    }

    // Called when user clicks "Continue to Estimate" on Step 2
    const handleApproveWorkAreas = async () => {
      const approved = workAreas.map((wa) => ({ ...wa, approved: true }))
      updateEstimate({ work_areas: approved })
      const pass2Result = await runAiPass2(approved)
      if (pass2Result?.scopeDescriptions) {
        setJamieScopes(pass2Result.scopeDescriptions)
      }
      if (pass2Result?.workAreaModes) {
        setWorkAreaModes(pass2Result.workAreaModes)
      }
      if (pass2Result?.structuredGapQuestions) {
        setStructuredGapQuestions(pass2Result.structuredGapQuestions)
      }
      if (pass2Result?.planReferences) {
        setPlanReferences(pass2Result.planReferences)
      }
      if (pass2Result?.jamieMessages) {
        setJamieMessages(pass2Result.jamieMessages)
      }
    }

    // Re-estimate a single work area after gap questions answered (Change B)
    const handleReEstimateWorkArea = async (waId: string, answers: GapQuestion[]) => {
      const wa = workAreas.find((w) => w.id === waId)
      if (!wa) return
      setReEstimateLoading(true)
      const success = await reEstimateWorkArea(wa, answers)
      if (success) {
        setWorkAreaModes((prev) => ({ ...prev, [waId]: estimate?.work_area_modes?.[waId] ?? 'full_takeoff' }))
        setStructuredGapQuestions((prev) => ({ ...prev, [waId]: estimate?.structured_gap_questions?.[waId] ?? [] }))
        if (estimate?.scope_descriptions?.[waId]) {
          setJamieScopes((prev) => ({ ...prev, [waId]: estimate!.scope_descriptions![waId] }))
        }
      }
      setReEstimateLoading(false)
    }

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
        <div className={`sticky ${bidclawAccessLevel === 'trial' ? 'top-[41px]' : 'top-0'} z-30 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3`}>
          <div className="flex items-center gap-3">
            <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-semibold text-gray-900">BidClaw</span>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="flex items-center gap-1 text-xs text-gray-400"><Cloud size={14} /> Saving...</span>}
            {!saving && <span className="flex items-center gap-1 text-xs text-green-600"><Check size={14} /> Saved</span>}
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
          {estLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
          ) : step <= 1 ? (
            <Step1ProjectInfo
              estimate={estimate}
              onGenerate={handleGenerate}
              onBack={() => setActiveEstimateId(null)}
              generating={aiLoading}
              onFieldChange={(updates) => updateEstimate(updates)}
            />
          ) : step === 2 ? (
            <Step2WorkAreas
              workAreas={workAreas}
              onUpdateWorkArea={(id: string, updates: Partial<WorkAreaData>) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === id ? { ...wa, ...updates } : wa) })
              }}
              onRemoveWorkArea={(id: string) => updateEstimate({ work_areas: workAreas.filter((wa) => wa.id !== id) })}
              onAddWorkArea={(name: string) => {
                const newWa: WorkAreaData = {
                  id: 'wa_' + Date.now(), name, description: '',
                  complexity: 'Moderate', approved: false,
                }
                updateEstimate({ work_areas: [...workAreas, newWa] })
              }}
              onApprove={handleApproveWorkAreas}
              onBack={() => updateEstimate({ workflow_step: 1 })}
            />
          ) : step === 3 ? (
            <Step3LineItems
              workAreas={workAreas}
              lineItems={lineItems}
              newCatalogItems={newCatalogItems}
              loading={aiLoading}
              loadingMessage={aiMessage}
              onUpdateLineItem={(waId: string, itemId: string, updates: Partial<LineItemData>) => {
                const waItems = (lineItems[waId] ?? []).map((li) => li.id === itemId ? { ...li, ...updates } : li)
                updateEstimate({ line_items: { ...lineItems, [waId]: waItems } })
              }}
              onRemoveLineItem={(waId: string, itemId: string) => {
                updateEstimate({ line_items: { ...lineItems, [waId]: (lineItems[waId] ?? []).filter((li) => li.id !== itemId) } })
              }}
              onAddLineItem={(waId: string) => {
                const newItem: LineItemData = {
                  id: 'li_' + Date.now(), name: '', quantity: 0, unit: 'EA', category: 'Materials', description: '',
                }
                updateEstimate({ line_items: { ...lineItems, [waId]: [...(lineItems[waId] ?? []), newItem] } })
              }}
              onAddCatalogLineItem={(waId: string, ci: CatalogItem) => {
                const category = categoryFromCatalogType(ci.type)
                const unit = unitFromCategory(category, 'EA')
                const newItem: LineItemData = {
                  id: 'li_' + Date.now(),
                  name: ci.name,
                  quantity: 1,
                  unit: unit as LineItemData['unit'],
                  category,
                  description: '',
                  catalog_item_id: ci.id,
                  catalog_match_type: 'matched',
                }
                updateEstimate({ line_items: { ...lineItems, [waId]: [...(lineItems[waId] ?? []), newItem] } })
              }}
              onApproveWorkArea={(waId: string) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === waId ? { ...wa, approved: true } : wa) })
              }}
              onUnapproveWorkArea={(waId: string) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === waId ? { ...wa, approved: false } : wa) })
              }}
              onSend={() => updateEstimate({ workflow_step: 4 })}
              onBack={() => updateEstimate({ workflow_step: 2 })}
              onBackToStep1={() => updateEstimate({ workflow_step: 1 })}
              // Jamie
              jamieBuilt={jamieBuilt}
              jamieScopes={jamieScopes}
              jamieScopeLoading={jamieScopeLoading}
              onJamieWriteScope={handleJamieWriteScope}
              onJamieUpdateScope={handleJamieUpdateScope}
              jamieAnalysis={jamieAnalysis}
              jamieAnalysisLoading={jamieAnalysisLoading}
              onJamieAnalyze={handleJamieAnalyze}
              workAreaModes={workAreaModes}
              structuredGapQuestions={structuredGapQuestions}
              onReEstimateWorkArea={handleReEstimateWorkArea}
              reEstimateLoading={reEstimateLoading}
              planReferences={planReferences}
              jamieMessages={jamieMessages}
            />
          ) : (
            <Step4Send
              estimate={estimate}
              workAreas={workAreas}
              lineItems={lineItems}
              newCatalogItemCount={newCatalogItems.length}
              onEdit={() => updateEstimate({ workflow_step: 3 })}
              onSend={sendToQuickCalc}
              onNewEstimate={() => { resetEstimateState(); setCurrentTab('estimates') }}
              jamieSummary={jamieSummary}
              jamieSummaryLoading={jamieSummaryLoading}
              onJamieGenerateSummary={handleJamieGenerateSummary}
              onJamieUpdateSummary={setJamieSummary}
              isTrial={bidclawAccessLevel === 'trial'}
              onUpgrade={() => setShowUpgrade(true)}
            />
          )}
        </div>
      </div>
    )
  }

  // Main app with nav
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
                  const id = await createEstimate({
                    client_name: '', project_address: '', project_description: '', plan_file_urls: [],
                  })
                  if (id) setActiveEstimateId(id)
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
