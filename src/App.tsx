import { useState, useCallback } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PromoScreen } from '@/components/PromoScreen'
import UpgradeModal from '@/components/UpgradeModal'
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
import { matchAllLineItems } from '@/lib/catalogMatcher'
import { Loader2, Cloud, Check } from 'lucide-react'

type Tab = 'company-info' | 'item-catalog' | 'production-rates' | 'about-kyn' | 'estimates'

function AppContent() {
  const { user, hasQCAccount, canAccessBidClaw, qcSettings, loading: authLoading } = useAuth()
  const [currentTab, setCurrentTab] = useState<Tab>('estimates')
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  const {
    estimate, loading: estLoading, saving, aiLoading, aiMessage,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass1, runAiPass2, sendToQuickCalc,
  } = useEstimate(activeEstimateId)

  const workAreas: WorkAreaData[] = estimate?.work_areas ?? []
  const lineItems: Record<string, LineItemData[]> = estimate?.line_items ?? {}
  const newCatalogItems: string[] = estimate?.new_catalog_items_created ?? []

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
      // Fetch user's catalog and production rates
      const [{ data: catalogData }, { data: ratesData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
      ])
      const userCatalog = (catalogData ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]

      const intakeContext = buildIntakeContext(jamieMessages)
      const result = await jamieBuildEstimate(
        intakeContext,
        estimate.client_name ?? '',
        estimate.project_address ?? '',
        userCatalog,
        productionRates
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
      toast.error(err instanceof Error ? err.message : 'Jamie could not build the estimate')
    } finally {
      setJamieBuildingEstimate(false)
    }
  }, [user, estimate, jamieMessages, updateEstimate])

  // Jamie: write scope for a work area
  const handleJamieWriteScope = useCallback(async (waId: string) => {
    const wa = workAreas.find((w) => w.id === waId)
    if (!wa) return
    setJamieScopeLoading(waId)
    try {
      const scope = await jamieWriteScope(wa.name, lineItems[waId] ?? [])
      setJamieScopes((prev) => ({ ...prev, [waId]: scope }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Jamie could not write scope')
    } finally {
      setJamieScopeLoading(null)
    }
  }, [workAreas, lineItems])

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
      toast.error(err instanceof Error ? err.message : 'Jamie could not generate summary')
    } finally {
      setJamieSummaryLoading(false)
    }
  }, [estimate, workAreas, lineItems])

  // Jamie: analyze estimate
  const handleJamieAnalyze = useCallback(async () => {
    if (!user) return
    setJamieAnalysisLoading(true)
    try {
      const [{ data: catalogData }, { data: ratesData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
      ])
      const userCatalog = (catalogData ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]
      const laborTypes = qcSettings?.laborTypes ?? []

      const result = await jamieAnalyzeEstimate(
        workAreas, lineItems, productionRates, userCatalog, laborTypes
      )
      setJamieAnalysis(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Jamie analysis failed')
    } finally {
      setJamieAnalysisLoading(false)
    }
  }, [user, workAreas, lineItems, qcSettings])

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
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
      client_name: string; project_address: string; project_description: string; files: File[]
    }) => {
      const urls = data.files.length > 0 ? await uploadFiles(data.files) : estimate.plan_file_urls
      updateEstimate({
        client_name: data.client_name,
        project_address: data.project_address,
        project_description: data.project_description,
        plan_file_urls: urls,
      })
      await runAiPass1()
    }

    const handleApproveWorkAreas = async () => {
      const approved = workAreas.map((wa) => ({ ...wa, approved: true }))
      updateEstimate({ work_areas: approved })
      await runAiPass2(approved)
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-semibold text-gray-900">BidClaw</span>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="flex items-center gap-1 text-xs text-gray-400"><Cloud size={14} /> Saving...</span>}
            {!saving && <span className="flex items-center gap-1 text-xs text-green-600"><Check size={14} /> Saved</span>}
            <button onClick={() => { setActiveEstimateId(null); setJamieMessages([]); setJamieBuilt(false); setJamieScopes({}); setJamieSummary(null); setJamieAnalysis(null) }}
              className="text-sm text-gray-500 hover:text-gray-900">Exit</button>
          </div>
        </div>

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
              jamieMessages={jamieMessages}
              jamieLoading={jamieLoading}
              jamieBuildingEstimate={jamieBuildingEstimate}
              onJamieStart={handleJamieStart}
              onJamieSendMessage={handleJamieSendMessage}
              onJamieBuildEstimate={handleJamieBuildEstimate}
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
            />
          ) : (
            <Step4Send
              estimate={estimate}
              workAreas={workAreas}
              lineItems={lineItems}
              newCatalogItemCount={newCatalogItems.length}
              onEdit={() => updateEstimate({ workflow_step: 3 })}
              onSend={sendToQuickCalc}
              onNewEstimate={() => { setActiveEstimateId(null); setCurrentTab('estimates'); setJamieMessages([]); setJamieBuilt(false); setJamieScopes({}); setJamieSummary(null); setJamieAnalysis(null) }}
              jamieSummary={jamieSummary}
              jamieSummaryLoading={jamieSummaryLoading}
              onJamieGenerateSummary={handleJamieGenerateSummary}
              onJamieUpdateSummary={setJamieSummary}
            />
          )}
        </div>
      </div>
    )
  }

  // Main app with nav
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar currentTab={currentTab} onTabChange={(tab: string) => setCurrentTab(tab as Tab)} />
      <div className="flex flex-1">
        {/* Left sidebar — Jamie */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col items-center bg-gradient-to-b from-slate-50 to-white border-r border-slate-200 px-4 py-8">
          <div className="sticky top-20">
            <img
              src="/jamie-avatar.png"
              alt="Jamie — AI Estimating Agent"
              className="w-56 rounded-2xl opacity-85 shadow-lg"
            />
            <p className="mt-3 text-center text-xs font-semibold text-slate-500 tracking-wide uppercase">
              AI Estimating Agent
            </p>
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
