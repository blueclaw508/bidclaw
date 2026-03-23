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
import MyKYNNumbers from '@/components/settings/MyKYNNumbers'
import { EstimateDashboard } from '@/components/estimate/EstimateDashboard'
import { Step1ProjectInfo } from '@/components/estimate/Step1ProjectInfo'
import { Step2WorkAreas } from '@/components/estimate/Step2WorkAreas'
import { JamieWorkAreaChoice } from '@/components/estimate/JamieWorkAreaChoice'
import { GapQuestions } from '@/components/estimate/GapQuestions'
import { Step3LineItems } from '@/components/estimate/Step3LineItems'
import { Step4Send } from '@/components/estimate/Step4Send'
import { useEstimate } from '@/hooks/useEstimate'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { WorkAreaData, LineItemData, CatalogItem, ProductionRate } from '@/lib/types'
import type { JamieMessage, JamieAnalysisResult } from '@/lib/jamie'
import {
  getNextIntakeQuestion,
  buildIntakeContext,
  jamieBuildEstimate,
  jamieWriteScope,
  jamieGenerateSummary,
  jamieAnalyzeEstimate,
} from '@/lib/jamie'
import { KYN_RATE_DEFAULTS } from '@/lib/jamiePrompt'
import type { KYNRates } from '@/lib/jamiePrompt'
import { matchAllLineItems } from '@/lib/catalogMatcher'
import { Loader2, Cloud, Check, Lock, Clock } from 'lucide-react'

type Tab = 'company-info' | 'item-catalog' | 'production-rates' | 'kyn-numbers' | 'about-kyn' | 'estimates'

function AppContent() {
  const { user, companyProfile, hasQCAccount, canAccessBidClaw, bidclawAccessLevel, trialDaysLeft, subscriptionTier, loading: authLoading } = useAuth()
  const [currentTab, setCurrentTab] = useState<Tab>('estimates')
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [jamieErrorOpen, setJamieErrorOpen] = useState(false)
  const [jamieErrorType, setJamieErrorType] = useState<JamieErrorType>('snag')
  const lastRetryAction = useRef<(() => void) | null>(null)

  const showJamieError = useCallback((errorMsg: string, retryAction?: () => void) => {
    setJamieErrorType(classifyJamieError(errorMsg))
    lastRetryAction.current = retryAction ?? null
    setJamieErrorOpen(true)
  }, [])

  const {
    estimate, loading: estLoading, saving, aiLoading, aiMessage,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass1, runAiPass2, sendToQuickCalc,
  } = useEstimate(activeEstimateId, showJamieError)

  const workAreas: WorkAreaData[] = estimate?.work_areas ?? []
  const lineItems: Record<string, LineItemData[]> = estimate?.line_items ?? {}
  const newCatalogItems: string[] = estimate?.new_catalog_items_created ?? []

  // KYN rates for pre-send summary
  const [kynRatesState, setKynRatesState] = useState<KYNRates>({ ...KYN_RATE_DEFAULTS })

  // Fetch KYN rates when estimate is loaded
  const fetchKynRates = useCallback(async () => {
    if (!user) return
    const { data } = await supabase.from('bidclaw_kyn_rates').select('*').eq('user_id', user.id).maybeSingle()
    if (data) {
      setKynRatesState({
        retail_labor_rate: data.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate,
        material_markup: data.material_markup ?? KYN_RATE_DEFAULTS.material_markup,
        sub_markup: data.sub_markup ?? KYN_RATE_DEFAULTS.sub_markup,
        equipment_markup: data.equipment_markup ?? KYN_RATE_DEFAULTS.equipment_markup,
      })
    }
  }, [user])

  useEffect(() => { fetchKynRates() }, [fetchKynRates])

  // Compute unpriced new catalog items (items with catalog_match_type=new_created and no unit_cost)
  const unpricedItemNames: string[] = []
  for (const items of Object.values(lineItems)) {
    for (const li of items) {
      if (li.catalog_match_type === 'new_created' && (li.unit_cost === null || li.unit_cost === undefined || li.unit_cost === 0)) {
        if (!unpricedItemNames.includes(li.name)) {
          unpricedItemNames.push(li.name)
        }
      }
    }
  }

  // ── Jamie State ──
  const [jamieMessages, setJamieMessages] = useState<JamieMessage[]>([])
  const [jamieLoading] = useState(false)
  const [jamieBuildingEstimate, setJamieBuildingEstimate] = useState(false)
  const [jamieBuilt, setJamieBuilt] = useState(false)
  const [jamieScopes, setJamieScopes] = useState<Record<string, string>>({})
  const [jamieScopeLoading, setJamieScopeLoading] = useState<string | null>(null)
  const [jamieSummary, setJamieSummary] = useState<string | null>(null)
  const [jamieSummaryLoading, setJamieSummaryLoading] = useState(false)
  const [jamieAnalysis, setJamieAnalysis] = useState<JamieAnalysisResult | null>(null)
  const [jamieAnalysisLoading, setJamieAnalysisLoading] = useState(false)
  const [pendingGapQuestions, setPendingGapQuestions] = useState<Record<string, string[]>>({})
  const [, setGapAnswers] = useState<Record<string, string>>({})
  const [showGapStep, setShowGapStep] = useState(false)
  const [showWorkAreaChoice, setShowWorkAreaChoice] = useState(false)
  const [, setPendingFormData] = useState<{
    client_name: string; project_address: string; project_description: string; files: File[]
  } | null>(null)
  const [manualWorkAreaMode, setManualWorkAreaMode] = useState(false)

  // Jamie: start intake
  const handleJamieStart = useCallback(() => {
    const firstQ = getNextIntakeQuestion([])
    if (firstQ) {
      setJamieMessages([{ role: 'jamie', content: firstQ }])
    }
  }, [])

  // Jamie: send user message
  const handleJamieSendMessage = useCallback((text: string) => {
    setJamieMessages((prev) => {
      const updated = [...prev, { role: 'user' as const, content: text }]
      // Add next question after a short delay
      const nextQ = getNextIntakeQuestion(updated)
      if (nextQ) {
        setTimeout(() => {
          setJamieMessages((p) => [...p, { role: 'jamie' as const, content: nextQ }])
        }, 600)
      } else {
        setTimeout(() => {
          setJamieMessages((p) => [
            ...p,
            { role: 'jamie' as const, content: "Great — I've got everything I need. Hit the button below and I'll build your estimate." },
          ])
        }, 600)
      }
      return updated
    })
  }, [])

  // Jamie: build estimate from intake
  const handleJamieBuildEstimate = useCallback(async () => {
    if (!user || !estimate) return
    setJamieBuildingEstimate(true)
    try {
      // Fetch user's catalog, production rates, and KYN rates
      const [{ data: catalogData }, { data: ratesData }, { data: kynData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_kyn_rates').select('*').eq('user_id', user.id).maybeSingle(),
      ])
      const userCatalog = (catalogData ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]
      const kynRates: KYNRates = kynData
        ? {
            retail_labor_rate: kynData.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate,
            material_markup: kynData.material_markup ?? KYN_RATE_DEFAULTS.material_markup,
            sub_markup: kynData.sub_markup ?? KYN_RATE_DEFAULTS.sub_markup,
            equipment_markup: kynData.equipment_markup ?? KYN_RATE_DEFAULTS.equipment_markup,
          }
        : { ...KYN_RATE_DEFAULTS }

      const intakeContext = buildIntakeContext(jamieMessages)
      const result = await jamieBuildEstimate(
        intakeContext,
        estimate.client_name ?? '',
        estimate.project_address ?? '',
        userCatalog,
        productionRates,
        kynRates
      )

      // Match line items to catalog
      const allItems = Object.values(result.line_items).flat()
      const matchResults = await matchAllLineItems(allItems, userCatalog, user.id)
      const newCatalogIds: string[] = []
      const matchedLineItems: Record<string, LineItemData[]> = {}

      for (const [waId, items] of Object.entries(result.line_items)) {
        matchedLineItems[waId] = items.map((li) => {
          const match = matchResults.get(li.id)
          if (match?.matchType === 'new_created') newCatalogIds.push(match.catalogItem.id)
          return { ...li, catalog_match_type: match?.matchType, catalog_item_id: match?.catalogItem.id }
        })
      }

      // Update estimate with Jamie's output
      updateEstimate({
        work_areas: result.work_areas,
        line_items: matchedLineItems,
        new_catalog_items_created: newCatalogIds,
        workflow_step: 3,
        approval_status: 'work_areas_approved',
      })

      setJamieScopes(result.scope_descriptions ?? {})
      setJamieBuilt(true)
      toast.success('Jamie built your estimate!')
    } catch (err) {
      showJamieError(
        err instanceof Error ? err.message : 'Jamie could not build the estimate',
        handleJamieBuildEstimate
      )
    } finally {
      setJamieBuildingEstimate(false)
    }
  }, [user, estimate, jamieMessages, updateEstimate, showJamieError])

  // Jamie: write scope for a work area (unified — returns scope + line items)
  const handleJamieWriteScope = useCallback(async (waId: string) => {
    const wa = workAreas.find((w) => w.id === waId)
    if (!wa || !user) return
    setJamieScopeLoading(waId)
    try {
      // Fetch catalog, rates, and KYN rates for unified prompt
      const [{ data: catalogData }, { data: ratesData }, { data: kynData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_kyn_rates').select('*').eq('user_id', user.id).maybeSingle(),
      ])
      const userCatalog = (catalogData ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]
      const kynRates: KYNRates = kynData
        ? {
            retail_labor_rate: kynData.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate,
            material_markup: kynData.material_markup ?? KYN_RATE_DEFAULTS.material_markup,
            sub_markup: kynData.sub_markup ?? KYN_RATE_DEFAULTS.sub_markup,
            equipment_markup: kynData.equipment_markup ?? KYN_RATE_DEFAULTS.equipment_markup,
          }
        : { ...KYN_RATE_DEFAULTS }

      const result = await jamieWriteScope(
        wa.name,
        lineItems[waId] ?? [],
        userCatalog,
        productionRates,
        kynRates,
        estimate?.project_description ?? undefined,
        (estimate?.plan_file_urls?.length ?? 0) > 0,
      )
      // Update both scope AND line items (Prime Directive enforcement)
      setJamieScopes((prev) => ({ ...prev, [waId]: result.scope_description }))
      if (result.line_items && result.line_items.length > 0) {
        updateEstimate({
          line_items: { ...lineItems, [waId]: result.line_items },
        })
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
      client_name: string; first_name: string; last_name: string;
      company_name: string | null; estimate_name: string | null;
      phone: string | null; email: string | null;
      address_line: string; city: string; state: string; zip: string;
      project_address: string; project_description: string; files: File[]
    }) => {
      try {
        const urls = data.files.length > 0 ? await uploadFiles(data.files) : estimate.plan_file_urls
        updateEstimate({
          client_name: data.client_name,
          first_name: data.first_name,
          last_name: data.last_name,
          company_name: data.company_name,
          estimate_name: data.estimate_name,
          phone: data.phone,
          email: data.email,
          address_line: data.address_line,
          city: data.city,
          state: data.state,
          zip: data.zip,
          project_address: data.project_address,
          project_description: data.project_description,
          plan_file_urls: urls,
        })
        // Store form data and show the Jamie work area choice card
        setPendingFormData(data)
        setShowWorkAreaChoice(true)
        // Move to step 2 so the choice card renders
        updateEstimate({ workflow_step: 2 })
      } catch {
        showJamieError('Jamie hit a snag — couldn\'t process your project files. Try again.')
      }
    }

    // User chose "Pull them from the plan" — run Pass1 as before
    const handlePullFromPlan = async () => {
      setManualWorkAreaMode(false)
      const pass1Result = await runAiPass1()
      setShowWorkAreaChoice(false)
      if (pass1Result?.gapQuestions) {
        const hasQuestions = Object.values(pass1Result.gapQuestions).some((qs) => qs.length > 0)
        if (hasQuestions) {
          setPendingGapQuestions(pass1Result.gapQuestions)
        }
      }
    }

    // User chose "I'll provide them" and submitted manual work area names
    const handleManualWorkAreas = async (workAreaNames: string[]) => {
      setManualWorkAreaMode(true)
      // Create work area objects from the names
      const manualWAs: WorkAreaData[] = workAreaNames.map((name, i) => ({
        id: `wa_${i + 1}`,
        name,
        description: name,
        complexity: 'Moderate' as const,
        approved: false,
      }))
      updateEstimate({ work_areas: manualWAs, workflow_step: 2, approval_status: 'draft' })
      setShowWorkAreaChoice(false)
    }

    // Called when user approves work areas — either directly or after answering gap questions
    const handleApproveWorkAreas = async (answeredGapQuestions?: Record<string, string>) => {
      // If there are pending gap questions the user hasn't seen yet, show Step 2.5
      if (!answeredGapQuestions) {
        const hasQuestions = Object.values(pendingGapQuestions).some((qs) => qs.length > 0)
        if (hasQuestions) {
          setShowGapStep(true)
          return
        }
      }

      // No gap questions or already answered — run Pass2
      const approved = workAreas.map((wa) => ({ ...wa, approved: true }))
      updateEstimate({ work_areas: approved })
      setShowGapStep(false)
      const pass2Result = await runAiPass2(approved, answeredGapQuestions, manualWorkAreaMode)
      if (pass2Result?.scopeDescriptions) {
        setJamieScopes(pass2Result.scopeDescriptions)
      }
    }

    const handleGapSubmit = async (answers: Record<string, string>) => {
      setGapAnswers(answers)
      setShowGapStep(false)
      // Now run Pass2 with gap answers injected
      await handleApproveWorkAreas(answers)
    }

    const handleGapSkip = async () => {
      setShowGapStep(false)
      // Run Pass2 without answers
      await handleApproveWorkAreas({})
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
            <button onClick={() => { setActiveEstimateId(null); setJamieMessages([]); setJamieBuilt(false); setJamieScopes({}); setJamieSummary(null); setJamieAnalysis(null); setShowGapStep(false); setPendingGapQuestions({}); setGapAnswers({}); setShowWorkAreaChoice(false); setPendingFormData(null); setManualWorkAreaMode(false) }}
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
              jamieMessages={jamieMessages}
              jamieLoading={jamieLoading}
              jamieBuildingEstimate={jamieBuildingEstimate}
              onJamieStart={handleJamieStart}
              onJamieSendMessage={handleJamieSendMessage}
              onJamieBuildEstimate={handleJamieBuildEstimate}
            />
          ) : step === 2 && showWorkAreaChoice ? (
            <JamieWorkAreaChoice
              contractorFirstName={companyProfile?.userName?.split(' ')[0] ?? ''}
              clientName={[estimate.first_name, estimate.last_name].filter(Boolean).join(' ') || estimate.client_name || ''}
              onPullFromPlan={handlePullFromPlan}
              onManualSubmit={handleManualWorkAreas}
              loading={aiLoading}
            />
          ) : step === 2 && showGapStep ? (
            <GapQuestions
              questions={pendingGapQuestions}
              workAreaNames={Object.fromEntries(workAreas.map((wa) => [wa.id, wa.name]))}
              onSubmit={handleGapSubmit}
              onSkip={handleGapSkip}
              onBack={() => setShowGapStep(false)}
              loading={aiLoading}
            />
          ) : step === 2 ? (
            <Step2WorkAreas
              workAreas={workAreas}
              loading={aiLoading}
              loadingMessage={aiMessage}
              onUpdateWorkArea={(id: string, updates: Partial<WorkAreaData>) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === id ? { ...wa, ...updates } : wa) })
              }}
              onRemoveWorkArea={(id: string) => updateEstimate({ work_areas: workAreas.filter((wa) => wa.id !== id) })}
              onAddWorkArea={() => {
                const newWa: WorkAreaData = {
                  id: 'wa_' + Date.now(), name: 'New Work Area', description: '',
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
              onApproveWorkArea={(waId: string) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === waId ? { ...wa, approved: true } : wa) })
              }}
              onUnapproveWorkArea={(waId: string) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === waId ? { ...wa, approved: false } : wa) })
              }}
              onUpdateWorkArea={(waId: string, updates: Partial<WorkAreaData>) => {
                updateEstimate({ work_areas: workAreas.map((wa) => wa.id === waId ? { ...wa, ...updates } : wa) })
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
              onNewItemPriceSaved={(catalogItemId, price) => {
                console.log(`[Catalog] Saved price $${price} for item ${catalogItemId}`)
              }}
              onAddMismatchItem={(waId, itemName) => {
                const newItem: LineItemData = {
                  id: 'li_' + Date.now(),
                  name: itemName,
                  quantity: 0,
                  unit: 'EA',
                  category: 'Materials',
                  description: `Added from scope mismatch: ${itemName}`,
                }
                updateEstimate({
                  line_items: { ...lineItems, [waId]: [...(lineItems[waId] ?? []), newItem] },
                })
              }}
            />
          ) : (
            <Step4Send
              estimate={estimate}
              workAreas={workAreas}
              lineItems={lineItems}
              newCatalogItemCount={newCatalogItems.length}
              unpricedItemNames={unpricedItemNames}
              kynRates={kynRatesState}
              onEdit={() => updateEstimate({ workflow_step: 3 })}
              onSend={sendToQuickCalc}
              onNewEstimate={() => { setActiveEstimateId(null); setCurrentTab('estimates'); setJamieMessages([]); setJamieBuilt(false); setJamieScopes({}); setJamieSummary(null); setJamieAnalysis(null); setShowGapStep(false); setPendingGapQuestions({}); setGapAnswers({}); setShowWorkAreaChoice(false); setPendingFormData(null); setManualWorkAreaMode(false) }}
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
            {currentTab === 'kyn-numbers' && <MyKYNNumbers />}
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
