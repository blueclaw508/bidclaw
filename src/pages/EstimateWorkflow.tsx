import { useEffect, useState, useCallback } from 'react'
import { supabase, invokeEdgeFunction } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  Estimate,
  WorkArea,
  LineItem,
  AiPlanAnalysis,
  AiTakeoffResponse,
  AiFullEstimateResponse,
  AiFullEstimateWorkArea,
  ProductionRate,
  MaterialCatalogItem,
  EquipmentItem,
  WorkType,
  QuickCalcPayload,
} from '@/lib/types'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import {
  LearningPrompt,
  detectLineItemEdits,
  type EditDiff,
} from '@/components/LearningPrompt'

interface EstimateWorkflowProps {
  estimateId: string
  onBack: () => void
}

type Phase = 1 | 2 | 3 | 4

// AI badge component
function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-dark">
      <Sparkles size={10} />
      AI
    </span>
  )
}

export function EstimateWorkflow({ estimateId, onBack }: EstimateWorkflowProps) {
  const { company } = useAuth()
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [phase, setPhase] = useState<Phase>(1)
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Phase 1: Work areas
  const [proposedAreas, setProposedAreas] = useState<
    { name: string; category: string; rationale: string; ai: boolean }[]
  >([])
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [questions, setQuestions] = useState<string[]>([])

  // Phase 2: Takeoffs (per work area)
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  const [lineItems, setLineItems] = useState<Record<string, LineItem[]>>({})

  // Phase 3: Full estimate data
  const [fullEstimate, setFullEstimate] = useState<AiFullEstimateWorkArea[]>([])
  const [manHourSummary, setManHourSummary] = useState<{
    total_man_hours: number
    total_days: number
    breakdown: { work_area: string; man_hours: number; days: number }[]
  } | null>(null)

  // Learning loop: track original AI values for diff detection
  const [originalLineItems, setOriginalLineItems] = useState<
    Record<string, { name: string; quantity: number; unit: string; unit_cost: number | null }[]>
  >({})
  const [learningDiffs, setLearningDiffs] = useState<EditDiff[]>([])
  const [showLearning, setShowLearning] = useState(false)

  // Company data for AI context
  const [companyData, setCompanyData] = useState<{
    rates: ProductionRate[]
    materials: MaterialCatalogItem[]
    equipment: EquipmentItem[]
    workTypes: WorkType[]
  }>({ rates: [], materials: [], equipment: [], workTypes: [] })

  // Load estimate and company data
  useEffect(() => {
    if (!company) return
    const load = async () => {
      const [estResult, ratesResult, matsResult, equipResult, typesResult, areasResult] =
        await Promise.all([
          supabase.from('estimates').select('*').eq('id', estimateId).single(),
          supabase.from('production_rates').select('*').eq('company_id', company.id),
          supabase.from('materials_catalog').select('*').eq('company_id', company.id),
          supabase.from('equipment_catalog').select('*').eq('company_id', company.id),
          supabase.from('work_types').select('*').eq('company_id', company.id),
          supabase.from('work_areas').select('*').eq('estimate_id', estimateId).order('sort_order'),
        ])

      if (estResult.data) setEstimate(estResult.data)
      setCompanyData({
        rates: ratesResult.data ?? [],
        materials: matsResult.data ?? [],
        equipment: equipResult.data ?? [],
        workTypes: typesResult.data ?? [],
      })

      // If work areas already exist, load them and determine phase
      if (areasResult.data && areasResult.data.length > 0) {
        setWorkAreas(areasResult.data)
        const allApproved = areasResult.data.every((wa: WorkArea) => wa.approved)

        // Load line items for existing work areas
        const waIds = areasResult.data.map((wa: WorkArea) => wa.id)
        const { data: items } = await supabase
          .from('line_items')
          .select('*')
          .in('work_area_id', waIds)
          .order('sort_order')

        if (items) {
          const grouped: Record<string, LineItem[]> = {}
          for (const item of items) {
            if (!grouped[item.work_area_id]) grouped[item.work_area_id] = []
            grouped[item.work_area_id].push(item)
          }
          setLineItems(grouped)
        }

        // Determine which phase to show
        if (estResult.data?.status === 'sent_to_quickcalc') {
          setPhase(4)
        } else if (estResult.data?.status === 'approved') {
          setPhase(4)
        } else if (items && items.length > 0 && allApproved) {
          setPhase(3)
        } else if (allApproved) {
          setPhase(2)
        } else {
          // Convert existing areas to proposal format for editing
          setProposedAreas(
            areasResult.data.map((wa: WorkArea) => ({
              name: wa.name,
              category: '',
              rationale: '',
              ai: wa.ai_generated,
            }))
          )
        }
      }

      setLoading(false)
    }
    load()
  }, [company, estimateId])

  // ── Phase 1: Analyze with AI ──
  const analyzeJob = useCallback(async () => {
    if (!company || !estimate) return
    setAiLoading(true)
    setError(null)

    try {
      // Get job description from ai_conversation or plan
      const jobText =
        estimate.ai_conversation?.[0]?.content ?? 'Plan uploaded — analyze the plan.'

      const { data, error: aiError } = await invokeEdgeFunction<AiPlanAnalysis>(
        'ai-chat',
        {
          action: 'analyze_plan',
          payload: {
            company_name: company.name,
            methodology: company.estimating_methodology,
            work_types: companyData.workTypes,
            job_text: jobText,
            plan_url: estimate.plan_url,
          },
        }
      )

      if (aiError) throw new Error(aiError)
      if (!data) throw new Error('No response from AI')

      setProposedAreas(
        data.work_areas.map((wa) => ({ ...wa, ai: true }))
      )
      setAssumptions(data.assumptions)
      setQuestions(data.questions)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setAiLoading(false)
    }
  }, [company, estimate, companyData.workTypes])

  // Auto-analyze on mount if no areas exist
  useEffect(() => {
    if (!loading && estimate && proposedAreas.length === 0 && workAreas.length === 0) {
      analyzeJob()
    }
  }, [loading, estimate, proposedAreas.length, workAreas.length, analyzeJob])

  // ── Phase 1: Approve work areas ──
  const approveWorkAreas = async () => {
    if (!estimate) return
    setAiLoading(true)
    try {
      // Delete existing work areas if re-doing
      if (workAreas.length > 0) {
        await supabase.from('work_areas').delete().eq('estimate_id', estimateId)
      }

      // Insert approved work areas
      const { data: insertedAreas, error: insertErr } = await supabase
        .from('work_areas')
        .insert(
          proposedAreas.map((wa, i) => ({
            estimate_id: estimateId,
            name: wa.name,
            sort_order: i,
            ai_generated: wa.ai,
            approved: true,
          }))
        )
        .select('*')

      if (insertErr) throw new Error(insertErr.message)
      setWorkAreas(insertedAreas ?? [])
      setPhase(2)
      toast.success('Work areas approved')

      // Now generate takeoffs
      await generateTakeoffs(insertedAreas ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save work areas'
      setError(msg)
      toast.error(msg)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Phase 2: Generate takeoffs ──
  const generateTakeoffs = async (areas: WorkArea[]) => {
    if (!company || !estimate) return
    setAiLoading(true)
    setError(null)

    try {
      const jobText =
        estimate.ai_conversation?.[0]?.content ?? 'Plan uploaded.'

      const { data, error: aiError } = await invokeEdgeFunction<AiTakeoffResponse>(
        'ai-chat',
        {
          action: 'generate_takeoffs',
          payload: {
            company_name: company.name,
            methodology: company.estimating_methodology,
            materials_catalog: companyData.materials,
            equipment_catalog: companyData.equipment,
            work_areas: areas.map((wa) => wa.name),
            job_text: jobText,
            plan_url: estimate.plan_url,
          },
        }
      )

      if (aiError) throw new Error(aiError)
      if (!data) throw new Error('No response from AI')

      // Save line items to database
      const newLineItems: Record<string, LineItem[]> = {}
      for (const aiWa of data.work_areas) {
        const matchingArea = areas.find(
          (wa) => wa.name.toLowerCase() === aiWa.name.toLowerCase()
        )
        if (!matchingArea) continue

        const items: Omit<LineItem, 'id'>[] = [
          ...aiWa.materials.map((m, i) => ({
            work_area_id: matchingArea.id,
            type: 'material' as const,
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            unit_cost: m.unit_cost,
            total_cost: m.quantity * m.unit_cost,
            ai_generated: true,
            sort_order: i,
          })),
          ...aiWa.equipment.map((e, i) => ({
            work_area_id: matchingArea.id,
            type: 'equipment' as const,
            name: e.name,
            quantity: e.hours,
            unit: 'HR',
            unit_cost: null,
            total_cost: null,
            ai_generated: true,
            sort_order: aiWa.materials.length + i,
          })),
        ]

        if (items.length > 0) {
          const { data: inserted } = await supabase
            .from('line_items')
            .insert(items)
            .select('*')
          newLineItems[matchingArea.id] = inserted ?? []
        }
      }

      setLineItems(newLineItems)

      // Save a snapshot of original AI values for learning loop
      const origSnapshot: Record<string, { name: string; quantity: number; unit: string; unit_cost: number | null }[]> = {}
      for (const [waId, items] of Object.entries(newLineItems)) {
        origSnapshot[waId] = items.map((li) => ({
          name: li.name,
          quantity: li.quantity,
          unit: li.unit ?? '',
          unit_cost: li.unit_cost,
        }))
      }
      setOriginalLineItems(origSnapshot)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Takeoff generation failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Phase 2: Approve takeoffs ──
  const approveTakeoffs = async () => {
    // Check for edits → learning loop
    const allCurrentItems = Object.entries(lineItems).flatMap(([, items]) =>
      items.map((li) => ({
        name: li.name,
        quantity: li.quantity,
        unit: li.unit ?? '',
        unit_cost: li.unit_cost,
      }))
    )
    const allOrigItems = Object.values(originalLineItems).flat()
    const diffs = detectLineItemEdits(allOrigItems, allCurrentItems)

    if (diffs.length > 0) {
      setLearningDiffs(diffs)
      setShowLearning(true)
    }

    setPhase(3)
    toast.success('Takeoffs approved')
    await generateFullEstimate()
  }

  // ── Phase 3: Generate full estimate ──
  const generateFullEstimate = async () => {
    if (!company || !estimate) return
    setAiLoading(true)
    setError(null)

    try {
      const takeoffData = workAreas.map((wa) => ({
        name: wa.name,
        materials: (lineItems[wa.id] ?? [])
          .filter((li) => li.type === 'material')
          .map((li) => ({
            name: li.name,
            quantity: li.quantity,
            unit: li.unit,
            unit_cost: li.unit_cost,
          })),
        equipment: (lineItems[wa.id] ?? [])
          .filter((li) => li.type === 'equipment')
          .map((li) => ({
            name: li.name,
            hours: li.quantity,
          })),
      }))

      const { data, error: aiError } = await invokeEdgeFunction<AiFullEstimateResponse>(
        'ai-chat',
        {
          action: 'complete_estimate',
          payload: {
            company_name: company.name,
            methodology: company.estimating_methodology,
            production_rates: companyData.rates,
            crew_full_day_men: company.crew_full_day_men,
            crew_full_day_hours: company.crew_full_day_hours,
            crew_half_day_hours: company.crew_half_day_hours,
            takeoffs: takeoffData,
          },
        }
      )

      if (aiError) throw new Error(aiError)
      if (!data) throw new Error('No response from AI')

      setFullEstimate(data.work_areas)
      setManHourSummary(data.man_hour_summary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Estimate completion failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Phase 3: Approve estimate ──
  const approveEstimate = async () => {
    if (!estimate) return
    // Save notes and labor data to work areas
    for (const feWa of fullEstimate) {
      const matchingArea = workAreas.find(
        (wa) => wa.name.toLowerCase() === feWa.name.toLowerCase()
      )
      if (!matchingArea) continue

      await supabase
        .from('work_areas')
        .update({
          notes: feWa.notes,
          total_man_hours: feWa.labor.man_hours,
          day_increment: feWa.labor.increment,
          approved: true,
        })
        .eq('id', matchingArea.id)

      // Add labor and general conditions line items
      await supabase.from('line_items').insert([
        {
          work_area_id: matchingArea.id,
          type: 'labor',
          name: `Labor — ${feWa.labor.days} ${feWa.labor.increment} day(s)`,
          quantity: feWa.labor.man_hours,
          unit: 'MH',
          unit_cost: null,
          total_cost: null,
          ai_generated: true,
          sort_order: 100,
        },
        {
          work_area_id: matchingArea.id,
          type: 'general_conditions',
          name: 'General Conditions',
          quantity: 1,
          unit: 'LS',
          unit_cost: feWa.general_conditions.amount,
          total_cost: feWa.general_conditions.amount,
          ai_generated: true,
          sort_order: 101,
        },
      ])
    }

    await supabase
      .from('estimates')
      .update({ status: 'approved' })
      .eq('id', estimateId)

    setEstimate((prev) => (prev ? { ...prev, status: 'approved' } : prev))
    setPhase(4)
    toast.success('Estimate approved — ready to send to QuickCalc')
  }

  // ── Phase 4: Send to QuickCalc ──
  const [sendConfirm, setSendConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  const sendToQuickCalc = async () => {
    if (!estimate || !company) return
    setSending(true)

    try {
      const payload: QuickCalcPayload = {
        source: 'bidclaw',
        estimate: {
          client_name: estimate.client_name,
          client_email: estimate.client_email,
          job_address: estimate.job_address,
          date: new Date().toISOString().split('T')[0],
          work_areas: fullEstimate.map((wa, i) => ({
            name: wa.name,
            sort_order: i,
            notes: wa.notes,
            materials: wa.materials.map((m) => ({
              name: m.name,
              quantity: m.quantity,
              unit: m.unit,
              unit_cost: m.unit_cost,
            })),
            equipment: wa.equipment.map((e) => ({
              name: e.name,
              hours: e.hours,
            })),
            labor: wa.labor,
            general_conditions: wa.general_conditions.amount,
          })),
          man_hour_summary: manHourSummary
            ? {
                total_man_hours: manHourSummary.total_man_hours,
                total_days: manHourSummary.total_days,
              }
            : { total_man_hours: 0, total_days: 0 },
        },
      }

      const { error: sendErr } = await invokeEdgeFunction('send-to-quickcalc', {
        payload,
      })

      if (sendErr) throw new Error(sendErr)

      await supabase
        .from('estimates')
        .update({ status: 'sent_to_quickcalc' })
        .eq('id', estimateId)

      setEstimate((prev) =>
        prev ? { ...prev, status: 'sent_to_quickcalc' } : prev
      )
      toast.success('Estimate sent to QuickCalc!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send'
      setError(msg)
      toast.error(msg)
    } finally {
      setSending(false)
      setSendConfirm(false)
    }
  }

  // ── Render ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gold" size={32} />
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Estimate not found.
        <button onClick={onBack} className="ml-2 text-gold hover:text-gold-dark">
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-navy"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </button>
        <h2 className="text-2xl font-bold text-navy">{estimate.client_name}</h2>
        <p className="text-sm text-muted-foreground">
          {[estimate.job_address, estimate.job_city, estimate.job_state]
            .filter(Boolean)
            .join(', ')}
        </p>
      </div>

      {/* Phase stepper */}
      <div className="mb-8 flex items-center gap-2">
        {([1, 2, 3, 4] as Phase[]).map((p) => (
          <div key={p} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                p < phase
                  ? 'bg-gold text-navy'
                  : p === phase
                  ? 'bg-navy text-white'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {p < phase ? <Check size={14} /> : p}
            </div>
            <span
              className={`hidden text-sm font-medium sm:block ${
                p === phase ? 'text-navy' : 'text-muted-foreground'
              }`}
            >
              {p === 1
                ? 'Work Areas'
                : p === 2
                ? 'Takeoffs'
                : p === 3
                ? 'Full Estimate'
                : 'Send'}
            </span>
            {p < 4 && <div className="mx-2 hidden h-px w-8 bg-border sm:block" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle size={16} />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => {
              setError(null)
              if (phase === 1) analyzeJob()
              else if (phase === 2) generateTakeoffs(workAreas)
              else if (phase === 3) generateFullEstimate()
            }}
            className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {/* ═══════ PHASE 1: Work Areas ═══════ */}
      {phase === 1 && (
        <div className="space-y-4">
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-white py-16">
              <Loader2 className="mb-4 animate-spin text-gold" size={32} />
              <p className="text-sm font-medium text-muted-foreground">
                AI is analyzing the job...
              </p>
            </div>
          ) : (
            <>
              {assumptions.length > 0 && (
                <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-gold-dark">
                    AI Assumptions
                  </p>
                  <ul className="space-y-1 text-sm text-foreground">
                    {assumptions.map((a, i) => (
                      <li key={i}>• {a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {questions.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-blue-800">
                    AI Questions
                  </p>
                  <ul className="space-y-1 text-sm text-blue-900">
                    {questions.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-border bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Proposed Work Areas
                </h3>
                <div className="space-y-3">
                  {proposedAreas.map((wa, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-border p-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            value={wa.name}
                            onChange={(e) => {
                              const updated = [...proposedAreas]
                              updated[i] = { ...updated[i], name: e.target.value }
                              setProposedAreas(updated)
                            }}
                            className="flex-1 font-medium text-navy outline-none border-b border-transparent focus:border-gold"
                          />
                          {wa.ai && <AiBadge />}
                        </div>
                        {wa.rationale && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {wa.rationale}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          setProposedAreas(proposedAreas.filter((_, idx) => idx !== i))
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setProposedAreas([
                      ...proposedAreas,
                      { name: '', category: '', rationale: '', ai: false },
                    ])
                  }
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
                >
                  <Plus size={16} />
                  Add Work Area
                </button>
              </div>

              <button
                onClick={approveWorkAreas}
                disabled={proposedAreas.length === 0 || proposedAreas.some((wa) => !wa.name.trim())}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-3 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors"
              >
                Approve Work Areas
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ PHASE 2: Takeoffs ═══════ */}
      {phase === 2 && (
        <div className="space-y-6">
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-white py-16">
              <Loader2 className="mb-4 animate-spin text-gold" size={32} />
              <p className="text-sm font-medium text-muted-foreground">
                AI is generating takeoffs...
              </p>
            </div>
          ) : (
            <>
              {workAreas.map((wa) => (
                <div
                  key={wa.id}
                  className="rounded-xl border border-border bg-white p-6"
                >
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-navy">
                    {wa.name}
                    {wa.ai_generated && <AiBadge />}
                  </h3>

                  {/* Materials */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs font-medium uppercase text-muted-foreground">
                        <th className="pb-2">Item</th>
                        <th className="pb-2 text-right">Qty</th>
                        <th className="pb-2 text-right">Unit</th>
                        <th className="pb-2 text-right">Unit Cost</th>
                        <th className="pb-2 text-right">Total</th>
                        <th className="pb-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {(lineItems[wa.id] ?? []).map((li, liIdx) => (
                        <tr key={li.id} className="border-b border-border/50">
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <input
                                value={li.name}
                                onChange={(e) => {
                                  const updated = { ...lineItems }
                                  updated[wa.id] = [...(updated[wa.id] ?? [])]
                                  updated[wa.id][liIdx] = { ...li, name: e.target.value }
                                  setLineItems(updated)
                                }}
                                className="w-full outline-none border-b border-transparent focus:border-gold"
                              />
                              {li.ai_generated && <AiBadge />}
                            </div>
                          </td>
                          <td className="py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={li.quantity}
                              onChange={(e) => {
                                const qty = Number(e.target.value)
                                const updated = { ...lineItems }
                                updated[wa.id] = [...(updated[wa.id] ?? [])]
                                updated[wa.id][liIdx] = {
                                  ...li,
                                  quantity: qty,
                                  total_cost: li.unit_cost ? qty * li.unit_cost : null,
                                }
                                setLineItems(updated)
                              }}
                              className="w-20 text-right outline-none border-b border-transparent focus:border-gold"
                            />
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {li.unit}
                          </td>
                          <td className="py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={li.unit_cost ?? ''}
                              onChange={(e) => {
                                const cost = Number(e.target.value)
                                const updated = { ...lineItems }
                                updated[wa.id] = [...(updated[wa.id] ?? [])]
                                updated[wa.id][liIdx] = {
                                  ...li,
                                  unit_cost: cost,
                                  total_cost: li.quantity * cost,
                                }
                                setLineItems(updated)
                              }}
                              className="w-20 text-right outline-none border-b border-transparent focus:border-gold"
                            />
                          </td>
                          <td className="py-2 text-right font-medium">
                            {li.total_cost != null
                              ? `$${li.total_cost.toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={async () => {
                                await supabase.from('line_items').delete().eq('id', li.id)
                                const updated = { ...lineItems }
                                updated[wa.id] = updated[wa.id].filter((_, idx) => idx !== liIdx)
                                setLineItems(updated)
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button
                    onClick={async () => {
                      const { data: newItem } = await supabase
                        .from('line_items')
                        .insert({
                          work_area_id: wa.id,
                          type: 'material',
                          name: '',
                          quantity: 0,
                          unit: 'EA',
                          unit_cost: 0,
                          total_cost: 0,
                          ai_generated: false,
                          sort_order: (lineItems[wa.id]?.length ?? 0),
                        })
                        .select('*')
                        .single()

                      if (newItem) {
                        const updated = { ...lineItems }
                        updated[wa.id] = [...(updated[wa.id] ?? []), newItem]
                        setLineItems(updated)
                      }
                    }}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
                  >
                    <Plus size={14} />
                    Add Line Item
                  </button>
                </div>
              ))}

              <button
                onClick={approveTakeoffs}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-3 text-sm font-semibold text-white hover:bg-navy-light transition-colors"
              >
                Approve Takeoffs
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ PHASE 3: Full Estimate ═══════ */}
      {phase === 3 && (
        <div className="space-y-6">
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-white py-16">
              <Loader2 className="mb-4 animate-spin text-gold" size={32} />
              <p className="text-sm font-medium text-muted-foreground">
                AI is completing the estimate...
              </p>
            </div>
          ) : (
            <>
              {showLearning && learningDiffs.length > 0 && (
                <LearningPrompt
                  diffs={learningDiffs}
                  onDismiss={() => {
                    setShowLearning(false)
                    setLearningDiffs([])
                  }}
                />
              )}

              {fullEstimate.map((wa, waIdx) => (
                <div
                  key={waIdx}
                  className="rounded-xl border border-border bg-white p-6"
                >
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-navy">
                    {wa.name}
                    <AiBadge />
                  </h3>

                  {/* Notes */}
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      Scope Notes
                    </p>
                    <div className="space-y-1">
                      {wa.notes.map((note, ni) => (
                        <div key={ni} className="flex items-start gap-2">
                          <span className="mt-0.5 text-gold">•</span>
                          <input
                            value={note}
                            onChange={(e) => {
                              const updated = [...fullEstimate]
                              updated[waIdx] = {
                                ...updated[waIdx],
                                notes: [...updated[waIdx].notes],
                              }
                              updated[waIdx].notes[ni] = e.target.value
                              setFullEstimate(updated)
                            }}
                            className="flex-1 text-sm outline-none border-b border-transparent focus:border-gold"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Materials summary */}
                  <div className="mb-3">
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Materials
                    </p>
                    <div className="space-y-1 text-sm">
                      {wa.materials.map((m, i) => (
                        <div key={i} className="flex justify-between">
                          <span>
                            {m.name} — {m.quantity} {m.unit}
                          </span>
                          <span className="font-medium">
                            ${(m.quantity * m.unit_cost).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Equipment */}
                  {wa.equipment.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        Equipment
                      </p>
                      <div className="space-y-1 text-sm">
                        {wa.equipment.map((e, i) => (
                          <div key={i}>
                            {e.name} — {e.hours} hrs
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Labor */}
                  <div className="mb-3">
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Labor
                    </p>
                    <p className="text-sm">
                      {wa.labor.man_hours} man-hours = {wa.labor.days}{' '}
                      {wa.labor.increment} day{wa.labor.days !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {/* General Conditions */}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      General Conditions
                    </p>
                    <p className="text-sm font-medium">
                      ${wa.general_conditions.amount.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}

              {/* Man Hour Summary */}
              {manHourSummary && (
                <div className="rounded-xl border-2 border-navy bg-navy/5 p-6">
                  <h3 className="mb-4 text-lg font-semibold text-navy">
                    Man Hour Budget Summary
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-3xl font-bold text-navy">
                        {manHourSummary.total_man_hours}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Man Hours</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-navy">
                        {manHourSummary.total_days}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Days</p>
                    </div>
                  </div>
                  {manHourSummary.breakdown.length > 0 && (
                    <div className="mt-4 space-y-1">
                      {manHourSummary.breakdown.map((b, i) => (
                        <div
                          key={i}
                          className="flex justify-between text-sm text-muted-foreground"
                        >
                          <span>{b.work_area}</span>
                          <span>
                            {b.man_hours} MH / {b.days} days
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={approveEstimate}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-3 text-sm font-semibold text-white hover:bg-navy-light transition-colors"
              >
                Approve Estimate
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ PHASE 4: Send to QuickCalc ═══════ */}
      {phase === 4 && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-white p-6">
            <div className="mb-6 flex items-center gap-3">
              <CheckCircle2 size={32} className="text-success" />
              <div>
                <h3 className="text-lg font-semibold text-navy">
                  Estimate {estimate.status === 'sent_to_quickcalc' ? 'Sent' : 'Approved'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {estimate.status === 'sent_to_quickcalc'
                    ? 'This estimate has been sent to QuickCalc.'
                    : 'Review the summary below and send to QuickCalc when ready.'}
                </p>
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client</span>
                <span className="font-medium">{estimate.client_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address</span>
                <span className="font-medium">
                  {[estimate.job_address, estimate.job_city, estimate.job_state]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Work Areas</span>
                <span className="font-medium">{workAreas.length}</span>
              </div>
              {manHourSummary && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Man Hours</span>
                    <span className="font-medium">{manHourSummary.total_man_hours}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Days</span>
                    <span className="font-medium">{manHourSummary.total_days}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {estimate.status !== 'sent_to_quickcalc' && (
            <>
              {!sendConfirm ? (
                <button
                  onClick={() => setSendConfirm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold py-4 text-lg font-bold text-navy hover:bg-gold-light transition-colors"
                >
                  <Send size={20} />
                  SEND TO QUICKCALC
                </button>
              ) : (
                <div className="rounded-xl border-2 border-gold bg-gold/5 p-6 text-center">
                  <p className="mb-4 font-semibold text-navy">
                    Are you sure you want to send this estimate to QuickCalc?
                  </p>
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => setSendConfirm(false)}
                      className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={sendToQuickCalc}
                      disabled={sending}
                      className="rounded-lg bg-gold px-6 py-2.5 text-sm font-bold text-navy hover:bg-gold-light disabled:opacity-50"
                    >
                      {sending ? 'Sending...' : 'Yes, Send It'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
