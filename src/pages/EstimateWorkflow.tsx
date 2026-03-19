import { useEffect, useState, useCallback } from 'react'
import { supabase, callAI, invokeEdgeFunction } from '@/lib/supabase'
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
  QCCatalogItem,
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
  BarChart3,
  FileText,
  ExternalLink,
} from 'lucide-react'
import {
  LearningPrompt,
  detectLineItemEdits,
  type EditDiff,
} from '@/components/LearningPrompt'
import { EfficiencyTracker } from '@/components/EfficiencyTracker'

interface EstimateWorkflowProps {
  estimateId: string
  onBack: () => void
}

type Phase = 1 | 2 | 3 | 4

// AI badge component
function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
      <Sparkles size={10} />
      AI
    </span>
  )
}

export function EstimateWorkflow({ estimateId, onBack }: EstimateWorkflowProps) {
  const { user, companyProfile } = useAuth()
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [phase, setPhase] = useState<Phase>(1)
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Job details (editable by user)
  const [jobDescription, setJobDescription] = useState('')

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
    Record<string, { name: string; quantity: number; unit: string }[]>
  >({})
  const [learningDiffs, setLearningDiffs] = useState<EditDiff[]>([])
  const [showLearning, setShowLearning] = useState(false)

  // Company data for AI context
  const [companyData, setCompanyData] = useState<{
    rates: ProductionRate[]
    materials: QCCatalogItem[]
    equipment: QCCatalogItem[]
    workTypes: WorkType[]
  }>({ rates: [], materials: [], equipment: [], workTypes: [] })

  // Load estimate and company data
  const loadEstimate = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [estResult, ratesResult, matsResult, equipResult, typesResult, areasResult] =
        await Promise.all([
          supabase.from('bidclaw_estimates').select('*').eq('id', estimateId).single(),
          supabase.from('bidclaw_production_rates').select('*').eq('user_id', user.id),
          supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).eq('type', 'material'),
          supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).eq('type', 'equipment'),
          supabase.from('bidclaw_work_types').select('*').eq('user_id', user.id),
          supabase.from('bidclaw_work_areas').select('*').eq('estimate_id', estimateId).order('sort_order'),
        ])

      if (estResult.error) {
        setError(estResult.error.message)
        setLoading(false)
        return
      }
      if (estResult.data) {
        setEstimate(estResult.data)
        // Populate editable job description from stored conversation
        setJobDescription(estResult.data.ai_conversation?.[0]?.content ?? '')
      }
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
          .from('bidclaw_line_items')
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load estimate data'
      setError(msg)
      setLoading(false)
    }
  }, [user, estimateId])

  useEffect(() => {
    loadEstimate()
  }, [loadEstimate])

  // ── Phase 1: Analyze with AI ──
  const analyzeJob = useCallback(async () => {
    if (!user || !estimate) return
    setAiLoading(true)
    setError(null)

    try {
      // Build user message content — include plan image and/or job description
      const jobText = jobDescription
      const planUrl = estimate.plan_url

      const contentParts: Array<Record<string, unknown>> = []

      // If there's a plan file, get a signed URL and send for AI to analyze
      if (planUrl) {
        // Extract the storage path from the public URL
        const pathMatch = planUrl.match(/\/object\/public\/plans\/(.+)$/)
        const storagePath = pathMatch?.[1]

        if (storagePath) {
          // Generate a signed URL that the Netlify function can download
          const { data: signedData } = await supabase.storage
            .from('plans')
            .createSignedUrl(storagePath, 300) // 5 min expiry

          if (signedData?.signedUrl) {
            const ext = storagePath.split('.').pop()?.toLowerCase()
            contentParts.push({
              type: ext === 'pdf' ? 'document' : 'image',
              source: { type: 'url', url: signedData.signedUrl },
            })
          }
        }
      }

      // Add text description
      contentParts.push({
        type: 'text',
        text: jobText || (planUrl
          ? 'Analyze this plan and propose work areas for the job.'
          : 'No plan or description provided. Propose typical landscaping work areas.'),
      })

      const systemPrompt = `You are BidClaw, an AI estimating assistant for ${companyProfile?.companyName ?? 'a contractor'}.
You are analyzing a job to propose work areas. Known work types: ${companyData.workTypes.map(w => w.name).join(', ') || 'general construction'}.
Respond in JSON only with this format: { "work_areas": [{ "name": "", "category": "", "rationale": "" }], "assumptions": [], "questions": [] }`

      const { data, error: aiError } = await callAI<AiPlanAnalysis>({
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      })

      if (aiError) throw new Error(aiError)
      if (!data) throw new Error('No response from AI')
      if (!data.work_areas?.length) throw new Error('AI did not return any work areas')

      setProposedAreas(
        data.work_areas.map((wa) => ({ ...wa, ai: true }))
      )
      setAssumptions(data.assumptions ?? [])
      setQuestions(data.questions ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setAiLoading(false)
    }
  }, [user, estimate, jobDescription, companyProfile, companyData.workTypes])

  // Save updated job description to the estimate
  const saveJobDescription = useCallback(async () => {
    if (!estimate) return
    await supabase
      .from('bidclaw_estimates')
      .update({
        ai_conversation: jobDescription
          ? [{ role: 'user', content: jobDescription }]
          : null,
      })
      .eq('id', estimate.id)
  }, [estimate, jobDescription])

  // ── Phase 1: Approve work areas ──
  const approveWorkAreas = async () => {
    if (!estimate) return
    setAiLoading(true)
    try {
      // Delete existing work areas if re-doing
      if (workAreas.length > 0) {
        await supabase.from('bidclaw_work_areas').delete().eq('estimate_id', estimateId)
      }

      // Insert approved work areas
      const { data: insertedAreas, error: insertErr } = await supabase
        .from('bidclaw_work_areas')
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
    if (!user || !estimate) return
    setAiLoading(true)
    setError(null)

    try {
      const jobText =
        estimate.ai_conversation?.[0]?.content ?? 'Plan uploaded.'

      const materialNames = companyData.materials.map(m => m.name).filter(Boolean).join(', ')
      const equipmentNames = companyData.equipment.map(e => e.name).filter(Boolean).join(', ')
      const systemPrompt = `You are BidClaw, an AI estimating assistant for ${companyProfile?.companyName ?? 'a contractor'}.
Generate material takeoffs for approved work areas. Known materials: ${materialNames || 'general'}. Known equipment: ${equipmentNames || 'general'}.
Respond in JSON only: { "work_areas": [{ "name": "", "materials": [{ "name": "", "quantity": 0, "unit": "", "rationale": "" }], "equipment": [{ "name": "", "hours": 0 }], "assumptions": [] }] }`

      const { data, error: aiError } = await callAI<AiTakeoffResponse>({
        system: systemPrompt,
        messages: [{ role: 'user', content: `Work areas: ${areas.map(wa => wa.name).join(', ')}.\nJob details: ${jobText}` }],
      })

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
            ai_generated: true,
            sort_order: i,
          })),
          ...aiWa.equipment.map((e, i) => ({
            work_area_id: matchingArea.id,
            type: 'equipment' as const,
            name: e.name,
            quantity: e.hours,
            unit: 'HR',
            ai_generated: true,
            sort_order: aiWa.materials.length + i,
          })),
        ]

        if (items.length > 0) {
          const { data: inserted } = await supabase
            .from('bidclaw_line_items')
            .insert(items)
            .select('*')
          newLineItems[matchingArea.id] = inserted ?? []
        }
      }

      setLineItems(newLineItems)

      // Save a snapshot of original AI values for learning loop
      const origSnapshot: Record<string, { name: string; quantity: number; unit: string }[]> = {}
      for (const [waId, items] of Object.entries(newLineItems)) {
        origSnapshot[waId] = items.map((li) => ({
          name: li.name,
          quantity: li.quantity,
          unit: li.unit ?? '',
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
        unit_cost: null,
      }))
    )
    const allOrigItems = Object.values(originalLineItems).flat().map((li) => ({ ...li, unit_cost: null }))
    const diffs = detectLineItemEdits(allOrigItems, allCurrentItems)

    if (diffs.length > 0) {
      setLearningDiffs(diffs)
      setShowLearning(true)
    }

    setPhase(3)
    setHasUnsavedEdits(false)
    toast.success('Takeoffs approved')
    await generateFullEstimate()
  }

  // ── Phase 3: Generate full estimate ──
  const generateFullEstimate = async () => {
    if (!user || !estimate) return
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
          })),
        equipment: (lineItems[wa.id] ?? [])
          .filter((li) => li.type === 'equipment')
          .map((li) => ({
            name: li.name,
            hours: li.quantity,
          })),
      }))

      const ratesText = companyData.rates.map(r => `${r.work_type}: ${r.man_hours_per_unit} MH/${r.unit}`).join(', ')
      const systemPrompt = `You are BidClaw, an AI estimating assistant for ${companyProfile?.companyName ?? 'a contractor'}.
Complete the full estimate — calculate labor hours, write work area notes in bullet format, and add general conditions.
Production rates: ${ratesText || 'use industry standard rates'}.
For each work area, use the crew size and hours/day provided to round labor to crew-day increments.
Notes format: bullet points. First: what is being installed. Second: overall size/qty. Third: material specified. Remaining: work sequence. Last: Disposal Fees Included (if applicable).
Respond in JSON only: { "work_areas": [{ "name": "", "notes": ["bullet 1"], "materials": [{ "name": "", "quantity": 0, "unit": "" }], "equipment": [{ "name": "", "hours": 0 }], "labor": { "man_hours": 0, "increment": "full", "days": 1 }, "general_conditions": { "amount": 0 } }], "man_hour_summary": { "total_man_hours": 0, "total_days": 0, "breakdown": [] } }`

      const crewInfo = workAreas.map(wa => `${wa.name}: crew ${wa.crew_size} × ${wa.crew_hours_per_day} hr/day`).join('; ')
      const { data, error: aiError } = await callAI<AiFullEstimateResponse>({
        system: systemPrompt,
        messages: [{ role: 'user', content: `Crew info: ${crewInfo}\nTakeoffs: ${JSON.stringify(takeoffData)}` }],
      })

      if (aiError) throw new Error(aiError)
      if (!data) throw new Error('No response from AI')
      if (!data.work_areas?.length) throw new Error('AI did not return estimate data — try again')

      setFullEstimate(data.work_areas)
      setManHourSummary(data.man_hour_summary ?? null)
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
        .from('bidclaw_work_areas')
        .update({
          notes: feWa.notes,
          total_man_hours: feWa.labor.man_hours,
          crew_size: feWa.labor.crew_size,
          crew_hours_per_day: feWa.labor.crew_hours_per_day,
          approved: true,
        })
        .eq('id', matchingArea.id)

      // Add labor and general conditions line items
      await supabase.from('bidclaw_line_items').insert([
        {
          work_area_id: matchingArea.id,
          type: 'labor',
          name: `Labor — ${feWa.labor.days} day(s), crew of ${feWa.labor.crew_size}`,
          quantity: feWa.labor.man_hours,
          unit: 'MH',
          ai_generated: true,
          sort_order: 100,
        },
        {
          work_area_id: matchingArea.id,
          type: 'general_conditions',
          name: 'General Conditions',
          quantity: feWa.general_conditions.amount,
          unit: 'LS',
          ai_generated: true,
          sort_order: 101,
        },
      ])
    }

    await supabase
      .from('bidclaw_estimates')
      .update({ status: 'approved' })
      .eq('id', estimateId)

    setEstimate((prev) => (prev ? { ...prev, status: 'approved' } : prev))
    setPhase(4)
    toast.success('Estimate approved — ready to send to QuickCalc')
  }

  // ── Phase 4: Send to QuickCalc ──
  const [sendConfirm, setSendConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [showEfficiency, setShowEfficiency] = useState(false)
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false)

  const sendToQuickCalc = async () => {
    if (!estimate || !user) return
    setSending(true)

    try {
      const payload: QuickCalcPayload = {
        source: 'bidclaw',
        estimate: {
          client_name: estimate.client_name,
          client_email: estimate.client_email,
          client_phone: estimate.client_phone,
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
        .from('bidclaw_estimates')
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
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Estimate not found.
        <button onClick={onBack} className="ml-2 text-blue-500 hover:text-blue-700">
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
          onClick={() => {
            if (hasUnsavedEdits && !window.confirm('You have unsaved edits. Leave anyway?')) return
            onBack()
          }}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-blue-900"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </button>
        <h2 className="text-2xl font-bold text-blue-900">{estimate.client_name}</h2>
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
                  ? 'bg-blue-500 text-blue-900'
                  : p === phase
                  ? 'bg-blue-600 text-white'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {p < phase ? <Check size={14} /> : p}
            </div>
            <span
              className={`hidden text-sm font-medium sm:block ${
                p === phase ? 'text-blue-900' : 'text-muted-foreground'
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
              if (!estimate) loadEstimate()
              else if (phase === 1) analyzeJob()
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
          {/* Job Details — plan file + description */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Job Details
            </h3>

            {/* Uploaded plan file */}
            {estimate?.plan_url && (
              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-slate-500">Uploaded Plan</label>
                <a
                  href={estimate.plan_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <FileText size={16} />
                  {estimate.plan_url.split('/').pop()?.split('?')[0] ?? 'Plan file'}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* Editable job description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Job Description &amp; Notes for AI
              </label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                onBlur={saveJobDescription}
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
                placeholder="Describe the work: areas involved, materials specified, special conditions..."
              />
            </div>

            {/* Analyze button */}
            <button
              onClick={analyzeJob}
              disabled={aiLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}
            >
              <Sparkles size={16} />
              {proposedAreas.length > 0 ? 'Re-Analyze with AI' : 'Analyze with AI'}
            </button>
          </div>

          {aiLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-white py-16">
              <Loader2 className="mb-4 animate-spin text-blue-500" size={32} />
              <p className="text-sm font-medium text-muted-foreground">
                AI is analyzing the job...
              </p>
            </div>
          ) : (
            <>
              {assumptions.length > 0 && (
                <div className="rounded-lg border border-blue-400/30 bg-blue-500/5 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-blue-700">
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
                            className="flex-1 font-medium text-blue-900 outline-none border-b border-transparent focus:border-blue-400"
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
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-500 hover:text-blue-700"
                >
                  <Plus size={16} />
                  Add Work Area
                </button>
              </div>

              <button
                onClick={approveWorkAreas}
                disabled={proposedAreas.length === 0 || proposedAreas.some((wa) => !wa.name.trim())}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
        <div className="space-y-6" onInput={() => setHasUnsavedEdits(true)}>
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-white py-16">
              <Loader2 className="mb-4 animate-spin text-blue-500" size={32} />
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
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-blue-900">
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
                                className="w-full outline-none border-b border-transparent focus:border-blue-400"
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
                                }
                                setLineItems(updated)
                              }}
                              className="w-20 text-right outline-none border-b border-transparent focus:border-blue-400"
                            />
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {li.unit}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={async () => {
                                await supabase.from('bidclaw_line_items').delete().eq('id', li.id)
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
                        .from('bidclaw_line_items')
                        .insert({
                          work_area_id: wa.id,
                          type: 'material',
                          name: '',
                          quantity: 0,
                          unit: 'EA',
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
                    className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-500 hover:text-blue-700"
                  >
                    <Plus size={14} />
                    Add Line Item
                  </button>
                </div>
              ))}

              <button
                onClick={approveTakeoffs}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
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
              <Loader2 className="mb-4 animate-spin text-blue-500" size={32} />
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
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-blue-900">
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
                          <span className="mt-0.5 text-blue-500">•</span>
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
                            className="flex-1 text-sm outline-none border-b border-transparent focus:border-blue-400"
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
                      day{wa.labor.days !== 1 ? 's' : ''} (crew of {wa.labor.crew_size}, {wa.labor.crew_hours_per_day} hrs/day)
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
                <div className="rounded-xl border-2 border-blue-600 bg-blue-600/5 p-6">
                  <h3 className="mb-4 text-lg font-semibold text-blue-900">
                    Man Hour Budget Summary
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-3xl font-bold text-blue-900">
                        {manHourSummary.total_man_hours}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Man Hours</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-blue-900">
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
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
                <h3 className="text-lg font-semibold text-blue-900">
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

          {/* Efficiency tracker for sent estimates */}
          {estimate.status === 'sent_to_quickcalc' && !showEfficiency && (
            <button
              onClick={() => setShowEfficiency(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400/40 py-4 text-sm font-medium text-blue-700 hover:border-blue-400 hover:bg-blue-500/5 transition-colors"
            >
              <BarChart3 size={18} />
              Track Job Efficiency — How did the crew do?
            </button>
          )}

          {showEfficiency && manHourSummary && (
            <EfficiencyTracker
              estimateId={estimateId}
              budgetedManHours={manHourSummary.total_man_hours}
              jobName={estimate.client_name}
              onClose={() => setShowEfficiency(false)}
            />
          )}

          {estimate.status !== 'sent_to_quickcalc' && (
            <>
              {!sendConfirm ? (
                <button
                  onClick={() => setSendConfirm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-4 text-lg font-bold text-blue-900 hover:bg-blue-400 transition-colors"
                >
                  <Send size={20} />
                  SEND TO QUICKCALC
                </button>
              ) : (
                <div className="rounded-xl border-2 border-blue-400 bg-blue-500/5 p-6 text-center">
                  <p className="mb-4 font-semibold text-blue-900">
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
                      className="rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-bold text-blue-900 hover:bg-blue-400 disabled:opacity-50"
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
