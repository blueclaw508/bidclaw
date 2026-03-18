import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { invokeEdgeFunction } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  ProductionRate,
  MaterialCatalogItem,
  SubCatalogItem,
  EquipmentItem,
  WorkType,
  AiMessage,
} from '@/lib/types'
import { OVERHEAD_CATEGORIES, PRODUCTION_BENCHMARKS } from '@/lib/types'
import {
  Building2,
  DollarSign,
  Calculator,
  Target,
  Percent,
  Gauge,
  Package,
  Wrench,
  Truck,
  Layers,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  Send,
  Award,
  MessageSquare,
} from 'lucide-react'

interface SetupWizardProps {
  onComplete: () => void
}

const steps = [
  { label: 'Company', icon: Building2 },
  { label: 'Labor Burden', icon: DollarSign },
  { label: 'Overhead', icon: Calculator },
  { label: 'Profit & Rate', icon: Target },
  { label: 'Markups', icon: Percent },
  { label: 'Rates', icon: Gauge },
  { label: 'Materials', icon: Package },
  { label: 'Subs', icon: Wrench },
  { label: 'Equipment', icon: Truck },
  { label: 'Work Types', icon: Layers },
  { label: 'My Numbers', icon: Award },
]

// ── Currency formatter ──
const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtRate = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) + '/hr'

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { user, refreshCompany } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 0: Company
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [crewMen, setCrewMen] = useState(3)
  const [crewFullHours, setCrewFullHours] = useState(9)
  const [crewHalfHours, setCrewHalfHours] = useState(4.5)

  // Step 1: Labor Burden (KYN Phase A)
  const [baseWage, setBaseWage] = useState(22)
  const [payrollTaxRate, setPayrollTaxRate] = useState(12)
  const [workersCompRate, setWorkersCompRate] = useState(12)
  const [ptoDays, setPtoDays] = useState(10)
  const [unbillablePercent, setUnbillablePercent] = useState(15)

  // Step 2: Overhead (KYN Phase B)
  const [overhead, setOverhead] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const cat of OVERHEAD_CATEGORIES) init[cat.key] = 0
    return init
  })
  const [annualBillableHours, setAnnualBillableHours] = useState(() =>
    Math.round(crewMen * 1800 * 0.85)
  )

  // Step 3: Profit & Retail Rate (KYN Phase C)
  const [targetProfit, setTargetProfit] = useState(15)

  // Step 4: Markups (KYN Phase D)
  const [materialMarkup, setMaterialMarkup] = useState(25)
  const [subMarkup, setSubMarkup] = useState(15)
  const [disposalMarkup, setDisposalMarkup] = useState(20)
  const [deliveryMarkup, setDeliveryMarkup] = useState(20)

  // Step 5: Production rates
  const [rates, setRates] = useState<Partial<ProductionRate>[]>(() =>
    PRODUCTION_BENCHMARKS.map((b) => ({
      work_type: b.work_type,
      unit: b.unit,
      man_hours_per_unit: b.bca_rate ?? 0,
      notes: b.verified ? 'BCA verified' : '',
    }))
  )

  // Step 6: Materials
  const [materials, setMaterials] = useState<Partial<MaterialCatalogItem>[]>([])

  // Step 7: Subs
  const [subs, setSubs] = useState<Partial<SubCatalogItem>[]>([])

  // Step 8: Equipment
  const [equipment, setEquipment] = useState<Partial<EquipmentItem>[]>([])

  // Step 9: Work Types
  const [workTypes, setWorkTypes] = useState<Partial<WorkType>[]>([])

  // AI Methodology (embedded in company info or Phase F)
  const [methodology, setMethodology] = useState('')
  const [chatMessages, setChatMessages] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [showChat, setShowChat] = useState(false)

  // ═══════════════════════════════════════════
  // CALCULATED KYN VALUES (live updating)
  // ═══════════════════════════════════════════

  const laborCalcs = useMemo(() => {
    const payrollTax = baseWage * (payrollTaxRate / 100)
    const workersComp = baseWage * (workersCompRate / 100)
    const ptoBurden = (ptoDays / 250) * baseWage
    const burdenedCost = baseWage + payrollTax + workersComp + ptoBurden
    const efficiencyRate = (100 - unbillablePercent) / 100
    const trueCostPerHour = efficiencyRate > 0 ? burdenedCost / efficiencyRate : 0
    return { payrollTax, workersComp, ptoBurden, burdenedCost, efficiencyRate, trueCostPerHour }
  }, [baseWage, payrollTaxRate, workersCompRate, ptoDays, unbillablePercent])

  const overheadCalcs = useMemo(() => {
    const monthlyTotal = Object.values(overhead).reduce((sum, v) => sum + (v || 0), 0)
    const annualTotal = monthlyTotal * 12
    const perHour = annualBillableHours > 0 ? annualTotal / annualBillableHours : 0
    return { monthlyTotal, annualTotal, perHour }
  }, [overhead, annualBillableHours])

  const retailLaborRate = useMemo(() => {
    const totalCostPerHour = laborCalcs.trueCostPerHour + overheadCalcs.perHour
    const profitDivisor = 1 - targetProfit / 100
    return profitDivisor > 0 ? totalCostPerHour / profitDivisor : 0
  }, [laborCalcs.trueCostPerHour, overheadCalcs.perHour, targetProfit])

  // ── Methodology chat ──
  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return
    const userMsg: AiMessage = { role: 'user', content: chatInput.trim() }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setChatLoading(true)

    try {
      const { data, error } = await invokeEdgeFunction<{ message: string; methodology?: string }>(
        'ai-chat',
        {
          action: 'methodology_chat',
          payload: { messages: newMessages, company_name: companyName },
        }
      )
      if (error) throw new Error(error)
      const assistantMsg: AiMessage = {
        role: 'assistant',
        content: data?.message ?? 'I understand. Let me summarize.',
      }
      setChatMessages([...newMessages, assistantMsg])
      if (data?.methodology) setMethodology(data.methodology)
    } catch {
      setChatMessages([
        ...newMessages,
        { role: 'assistant', content: 'Connection issue. You can skip and come back later.' },
      ])
    } finally {
      setChatLoading(false)
    }
  }

  // ── Save all ──
  const handleFinish = async () => {
    if (!user) return
    setSaving(true)
    try {
      const { data: companyData, error: companyErr } = await supabase
        .from('companies')
        .insert({
          user_id: user.id,
          name: companyName || 'My Company',
          address: companyAddress || null,
          crew_full_day_men: crewMen,
          crew_full_day_hours: crewFullHours,
          crew_half_day_hours: crewHalfHours,
          estimating_methodology: methodology || null,

          // KYN Labor Burden
          base_hourly_wage: baseWage,
          payroll_tax_rate: payrollTaxRate,
          workers_comp_rate: workersCompRate,
          pto_days_per_year: ptoDays,
          unbillable_percent: unbillablePercent,
          burdened_labor_cost: laborCalcs.burdenedCost,
          true_cost_per_billable_hour: laborCalcs.trueCostPerHour,

          // KYN Overhead
          monthly_overhead: overhead,
          annual_overhead: overheadCalcs.annualTotal,
          annual_billable_hours: annualBillableHours,
          overhead_per_hour: overheadCalcs.perHour,

          // KYN Profit
          target_profit_percent: targetProfit,
          retail_labor_rate: retailLaborRate,

          // KYN Markups
          material_markup_percent: materialMarkup,
          sub_markup_percent: subMarkup,
          disposal_markup_percent: disposalMarkup,
          delivery_markup_percent: deliveryMarkup,

          kyn_setup_complete: true,
        })
        .select('id')
        .single()

      if (companyErr) throw new Error(companyErr.message)
      const companyId = companyData.id

      // Production rates
      const validRates = rates.filter((r) => r.work_type && r.unit && r.man_hours_per_unit)
      if (validRates.length > 0) {
        await supabase.from('production_rates').insert(
          validRates.map((r) => ({ ...r, company_id: companyId }))
        )
      }

      // Materials
      const validMats = materials.filter((m) => m.name && m.unit && m.unit_cost)
      if (validMats.length > 0) {
        await supabase.from('materials_catalog').insert(
          validMats.map((m) => ({ ...m, company_id: companyId }))
        )
      }

      // Subs
      const validSubs = subs.filter((s) => s.name && s.unit && s.unit_cost)
      if (validSubs.length > 0) {
        await supabase.from('subs_catalog').insert(
          validSubs.map((s) => ({ ...s, company_id: companyId }))
        )
      }

      // Equipment
      const validEquip = equipment.filter((e) => e.name)
      if (validEquip.length > 0) {
        await supabase.from('equipment_catalog').insert(
          validEquip.map((e) => ({ ...e, company_id: companyId }))
        )
      }

      // Work types
      const validTypes = workTypes.filter((w) => w.name && w.category)
      if (validTypes.length > 0) {
        await supabase.from('work_types').insert(
          validTypes.map((w) => ({ ...w, company_id: companyId }))
        )
      }

      await refreshCompany()
      toast.success('Setup complete — your numbers are loaded!')
      onComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const canNext =
    step === 0 ? companyName.trim().length > 0 :
    step === 1 ? baseWage > 0 :
    true

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar stepper */}
      <div className="hidden w-64 flex-shrink-0 overflow-y-auto bg-navy p-6 md:block">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-navy font-bold text-sm">
              BC
            </div>
            <span className="text-lg font-semibold">KYN Setup</span>
          </div>
        </div>
        <nav className="space-y-1">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <button
                key={i}
                onClick={() => i <= step && setStep(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  i === step
                    ? 'bg-white/10 text-white'
                    : i < step
                    ? 'text-gold cursor-pointer hover:bg-white/5'
                    : 'text-white/30 cursor-default'
                }`}
              >
                {i < step ? (
                  <Check size={16} className="text-gold" />
                ) : (
                  <Icon size={16} />
                )}
                {s.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3 md:hidden">
          <span className="text-sm font-medium text-muted-foreground">
            Step {step + 1} of {steps.length}
          </span>
          <span className="text-sm font-semibold text-navy">{steps[step].label}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="mx-auto max-w-2xl">

            {/* ═══ STEP 0: Company Info + Crew ═══ */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Company Information</h2>
                  <p className="text-sm text-muted-foreground">Basic info and crew configuration.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Company Name *</label>
                    <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      placeholder="Your Company Name" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Address</label>
                    <input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      placeholder="123 Main St, Anytown, MA 02101" />
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Crew Defaults</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium">Crew Size</label>
                      <input type="number" min={1} value={crewMen} onChange={(e) => setCrewMen(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Full Day Hrs</label>
                      <input type="number" step={0.5} value={crewFullHours} onChange={(e) => setCrewFullHours(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Half Day Hrs</label>
                      <input type="number" step={0.5} value={crewHalfHours} onChange={(e) => setCrewHalfHours(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                    </div>
                  </div>
                  <div className="rounded-lg bg-navy/5 p-3 text-sm">
                    <span className="font-medium text-navy">Full day:</span> {crewMen} × {crewFullHours} = <strong>{crewMen * crewFullHours} MH</strong>
                    <span className="mx-3 text-border">|</span>
                    <span className="font-medium text-navy">Half day:</span> {crewMen} × {crewHalfHours} = <strong>{crewMen * crewHalfHours} MH</strong>
                  </div>
                </div>

                {/* Optional AI methodology chat */}
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">AI Methodology Chat</h3>
                      <p className="text-xs text-muted-foreground">Optional — teach AI your estimating approach.</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowChat(!showChat)
                        if (!showChat && chatMessages.length === 0) {
                          setChatMessages([{
                            role: 'assistant',
                            content: "Tell me about the types of work your company does and how you typically estimate jobs. What trades do you cover? What's your typical project size and region?",
                          }])
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                    >
                      <MessageSquare size={14} />
                      {showChat ? 'Hide' : 'Start Chat'}
                    </button>
                  </div>
                  {showChat && (
                    <div className="mt-4">
                      <div className="h-64 overflow-y-auto rounded-lg border border-border p-3 space-y-2">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                              msg.role === 'user' ? 'bg-navy text-white' : 'bg-muted text-foreground'
                            }`}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking...</div>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                          placeholder="Describe your estimating approach..."
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                        <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                          className="rounded-lg bg-navy p-2 text-white disabled:opacity-50">
                          <Send size={16} />
                        </button>
                      </div>
                      {methodology && (
                        <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
                          <p className="mb-1 text-xs font-semibold uppercase text-gold-dark">AI Summary</p>
                          <p className="text-xs text-foreground whitespace-pre-wrap">{methodology}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ STEP 1: Labor Burden (KYN Phase A) ═══ */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">True Labor Cost</h2>
                  <p className="text-sm text-muted-foreground">
                    Most contractors think they know their labor cost — the real number is usually 40-60% higher than base wage.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Base Hourly Wage *</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">$</span>
                      <input type="number" step={0.5} min={0} value={baseWage}
                        onChange={(e) => setBaseWage(Number(e.target.value))}
                        className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
                      <span className="text-sm text-muted-foreground">/hr</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium">Payroll Tax Rate %</label>
                      <input type="number" step={0.5} value={payrollTaxRate}
                        onChange={(e) => setPayrollTaxRate(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">FICA, FUTA, SUTA</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Workers Comp Rate %</label>
                      <input type="number" step={0.5} value={workersCompRate}
                        onChange={(e) => setWorkersCompRate(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Varies by state & trade</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Paid Days Off/Year</label>
                      <input type="number" min={0} value={ptoDays}
                        onChange={(e) => setPtoDays(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Holidays + vacation</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Unbillable Time %</label>
                      <input type="number" step={1} min={0} max={50} value={unbillablePercent}
                        onChange={(e) => setUnbillablePercent(Number(e.target.value))}
                        className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Travel, shop, rain, training</p>
                    </div>
                  </div>
                </div>

                {/* Live calculation card */}
                <div className="rounded-xl border-2 border-navy bg-navy/5 p-6">
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-navy">Live Calculation</h3>
                  <div className="space-y-2 text-sm font-mono">
                    <div className="flex justify-between">
                      <span>Base Wage:</span>
                      <span>{fmt(baseWage)}/hr</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>+ Payroll Taxes ({payrollTaxRate}%):</span>
                      <span>{fmt(laborCalcs.payrollTax)}/hr</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>+ Workers Comp ({workersCompRate}%):</span>
                      <span>{fmt(laborCalcs.workersComp)}/hr</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>+ PTO Burden ({ptoDays} days):</span>
                      <span>{fmt(laborCalcs.ptoBurden)}/hr</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 font-semibold">
                      <span>= Burdened Labor Cost:</span>
                      <span>{fmtRate(laborCalcs.burdenedCost)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>÷ Efficiency ({100 - unbillablePercent}%):</span>
                      <span>÷ {laborCalcs.efficiencyRate.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-navy pt-2 text-lg font-bold text-navy">
                      <span>= True Cost per Billable Hour:</span>
                      <span>{fmtRate(laborCalcs.trueCostPerHour)}</span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg bg-gold/10 p-3 text-xs text-navy">
                    <strong>The gap:</strong> You pay {fmt(baseWage)}/hr but your true cost is{' '}
                    <strong>{fmtRate(laborCalcs.trueCostPerHour)}</strong> — that's{' '}
                    {fmt(laborCalcs.trueCostPerHour - baseWage)} more per hour than most contractors realize.
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 2: Overhead (KYN Phase B) ═══ */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Overhead Budget</h2>
                  <p className="text-sm text-muted-foreground">
                    Everything it costs to keep your business running that isn't a direct job cost.
                    Enter your best <strong>monthly</strong> estimate for each.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {OVERHEAD_CATEGORIES.map((cat) => (
                      <div key={cat.key} className="flex items-center gap-3">
                        <label className="flex-1 text-sm">{cat.label}</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            type="number"
                            step={100}
                            min={0}
                            value={overhead[cat.key] || ''}
                            onChange={(e) => setOverhead({ ...overhead, [cat.key]: Number(e.target.value) })}
                            className="w-28 rounded-lg border border-input px-2 py-1.5 text-right text-sm outline-none focus:border-gold"
                            placeholder="0"
                          />
                          <span className="text-xs text-muted-foreground">/mo</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-white p-6 space-y-3">
                  <label className="block text-sm font-medium">
                    Annual Billable Man Hours
                  </label>
                  <input type="number" min={0} value={annualBillableHours}
                    onChange={(e) => setAnnualBillableHours(Number(e.target.value))}
                    className="w-40 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                  <p className="text-xs text-muted-foreground">
                    Estimate: crew size × 1,800 hrs × efficiency rate = {crewMen} × 1,800 × {((100 - unbillablePercent) / 100).toFixed(2)} = {Math.round(crewMen * 1800 * ((100 - unbillablePercent) / 100))}
                  </p>
                </div>

                {/* Live overhead summary */}
                <div className="rounded-xl border-2 border-navy bg-navy/5 p-6">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-navy">{fmt(overheadCalcs.monthlyTotal)}</p>
                      <p className="text-xs text-muted-foreground">Monthly Overhead</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-navy">{fmt(overheadCalcs.annualTotal)}</p>
                      <p className="text-xs text-muted-foreground">Annual Overhead</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gold-dark">{fmtRate(overheadCalcs.perHour)}</p>
                      <p className="text-xs text-muted-foreground">Per Billable Hour</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 3: Profit & Retail Rate (KYN Phase C) ═══ */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Profit Target & Retail Rate</h2>
                  <p className="text-sm text-muted-foreground">
                    The final piece — your target net profit margin. This generates your retail labor rate.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">Target Net Profit %</label>
                    <input type="range" min={5} max={30} step={1} value={targetProfit}
                      onChange={(e) => setTargetProfit(Number(e.target.value))}
                      className="w-full accent-gold" />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>5% (minimum)</span>
                      <span className="text-lg font-bold text-navy">{targetProfit}%</span>
                      <span>30% (excellent)</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {[10, 15, 20, 25].map((p) => (
                      <button key={p} onClick={() => setTargetProfit(p)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          targetProfit === p ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:bg-navy/10'
                        }`}>
                        {p}%{p === 10 ? ' min' : p === 15 ? ' healthy' : p === 20 ? ' KYN goal' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {/* The big reveal */}
                <div className="rounded-xl border-2 border-gold bg-gradient-to-br from-navy to-navy-light p-8 text-white">
                  <h3 className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-gold">
                    Your Retail Labor Rate
                  </h3>
                  <div className="space-y-3 text-sm font-mono">
                    <div className="flex justify-between opacity-80">
                      <span>True Cost per Billable Hour:</span>
                      <span>{fmtRate(laborCalcs.trueCostPerHour)}</span>
                    </div>
                    <div className="flex justify-between opacity-80">
                      <span>+ Overhead per Billable Hour:</span>
                      <span>{fmtRate(overheadCalcs.perHour)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/20 pt-2">
                      <span>= Total Cost per Billable Hour:</span>
                      <span>{fmtRate(laborCalcs.trueCostPerHour + overheadCalcs.perHour)}</span>
                    </div>
                    <div className="flex justify-between opacity-80">
                      <span>÷ (1 - {targetProfit}% profit):</span>
                      <span>÷ {(1 - targetProfit / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t-2 border-gold pt-3 text-2xl font-bold">
                      <span>= RETAIL LABOR RATE:</span>
                      <span className="text-gold">{fmtRate(retailLaborRate)}</span>
                    </div>
                  </div>
                  <p className="mt-6 text-center text-xs text-white/70">
                    This rate goes into QuickCalc's My Numbers. Every labor line item uses it automatically.
                  </p>
                </div>
              </div>
            )}

            {/* ═══ STEP 4: Markups (KYN Phase D) ═══ */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Material & Sub Markups</h2>
                  <p className="text-sm text-muted-foreground">
                    Set your markups for materials and subcontractors. Applied automatically in QuickCalc.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-5">
                  {[
                    { label: 'Material Markup', value: materialMarkup, set: setMaterialMarkup,
                      hint: '20% competitive | 25% standard | 30-35% premium market' },
                    { label: 'Subcontractor Markup', value: subMarkup, set: setSubMarkup,
                      hint: 'You manage the sub, take risk, provide insurance coverage' },
                    { label: 'Disposal Markup', value: disposalMarkup, set: setDisposalMarkup,
                      hint: 'Applied to dump fees and disposal costs' },
                    { label: 'Delivery/Freight Markup', value: deliveryMarkup, set: setDeliveryMarkup,
                      hint: 'Applied to delivery charges' },
                  ].map((m) => (
                    <div key={m.label}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium">{m.label}</label>
                        <span className="text-lg font-bold text-navy">{m.value}%</span>
                      </div>
                      <input type="range" min={0} max={50} step={1} value={m.value}
                        onChange={(e) => m.set(Number(e.target.value))}
                        className="w-full accent-gold" />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{m.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ STEP 5: Production Rates (KYN Phase E) ═══ */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Production Rates</h2>
                  <p className="text-sm text-muted-foreground">
                    Man hours per unit for each work type. BCA verified rates shown where available — adjust to match your crew.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="mb-3 hidden grid-cols-[1fr_80px_100px_1fr_auto] gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid">
                    <div>Work Type</div>
                    <div>Unit</div>
                    <div>MH/Unit</div>
                    <div>Notes</div>
                    <div className="w-8" />
                  </div>
                  <div className="space-y-2">
                    {rates.map((rate, i) => (
                      <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_80px_100px_1fr_auto]">
                        <input value={rate.work_type ?? ''} onChange={(e) => {
                          const u = [...rates]; u[i] = { ...u[i], work_type: e.target.value }; setRates(u)
                        }} className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Work type" />
                        <input value={rate.unit ?? ''} onChange={(e) => {
                          const u = [...rates]; u[i] = { ...u[i], unit: e.target.value }; setRates(u)
                        }} className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Unit" />
                        <input type="number" step={0.1} value={rate.man_hours_per_unit ?? ''} onChange={(e) => {
                          const u = [...rates]; u[i] = { ...u[i], man_hours_per_unit: Number(e.target.value) }; setRates(u)
                        }} className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                        <input value={rate.notes ?? ''} onChange={(e) => {
                          const u = [...rates]; u[i] = { ...u[i], notes: e.target.value }; setRates(u)
                        }} className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Notes" />
                        <button onClick={() => setRates(rates.filter((_, idx) => idx !== i))}
                          className="flex items-center justify-center text-muted-foreground hover:text-destructive">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setRates([...rates, { work_type: '', unit: '', man_hours_per_unit: 0, notes: '' }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
                    <Plus size={16} /> Add Rate
                  </button>
                </div>
              </div>
            )}

            {/* ═══ STEP 6: Materials ═══ */}
            {step === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Materials Catalog</h2>
                  <p className="text-sm text-muted-foreground">Add materials with unit costs. Helps AI estimate accurately.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'Unit', 'Unit Cost', 'Supplier']}
                  rows={materials}
                  onAdd={() => setMaterials([...materials, { name: '', unit: '', unit_cost: 0, supplier: '' }])}
                  onRemove={(i) => setMaterials(materials.filter((_, idx) => idx !== i))}
                  onUpdate={(i, field, value) => { const u = [...materials]; (u[i] as Record<string, unknown>)[field] = value; setMaterials(u) }}
                  fields={['name', 'unit', 'unit_cost', 'supplier']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Dark Bark Mulch', 'CY', '45.00', 'Supplier name']}
                />
              </div>
            )}

            {/* ═══ STEP 7: Subs ═══ */}
            {step === 7 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Subcontractor Catalog</h2>
                  <p className="text-sm text-muted-foreground">Add sub costs for work you typically sub out.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'Unit', 'Unit Cost', 'Trade']}
                  rows={subs}
                  onAdd={() => setSubs([...subs, { name: '', unit: '', unit_cost: 0, trade: '' }])}
                  onRemove={(i) => setSubs(subs.filter((_, idx) => idx !== i))}
                  onUpdate={(i, field, value) => { const u = [...subs]; (u[i] as Record<string, unknown>)[field] = value; setSubs(u) }}
                  fields={['name', 'unit', 'unit_cost', 'trade']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Bobcat w/ Operator', 'HR', '125.00', 'Excavation']}
                />
              </div>
            )}

            {/* ═══ STEP 8: Equipment ═══ */}
            {step === 8 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Equipment List</h2>
                  <p className="text-sm text-muted-foreground">List equipment your company uses on jobs.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {equipment.map((item, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input value={item.name ?? ''} onChange={(e) => {
                          const u = [...equipment]; u[i] = { ...u[i], name: e.target.value }; setEquipment(u)
                        }} className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Equipment name" />
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input type="checkbox" checked={item.billable ?? true} onChange={(e) => {
                            const u = [...equipment]; u[i] = { ...u[i], billable: e.target.checked }; setEquipment(u)
                          }} className="rounded" />
                          Billable
                        </label>
                        <button onClick={() => setEquipment(equipment.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEquipment([...equipment, { name: '', billable: true }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
                    <Plus size={16} /> Add Equipment
                  </button>
                </div>
              </div>
            )}

            {/* ═══ STEP 9: Work Types ═══ */}
            {step === 9 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Work Types Library</h2>
                  <p className="text-sm text-muted-foreground">Define the types of work your company does.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {workTypes.map((wt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input value={wt.name ?? ''} onChange={(e) => {
                          const u = [...workTypes]; u[i] = { ...u[i], name: e.target.value }; setWorkTypes(u)
                        }} className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Work type name" />
                        <select value={wt.category ?? ''} onChange={(e) => {
                          const u = [...workTypes]; u[i] = { ...u[i], category: e.target.value }; setWorkTypes(u)
                        }} className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold">
                          <option value="">Category</option>
                          <option value="hardscape">Hardscape</option>
                          <option value="planting">Planting</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="irrigation">Irrigation</option>
                          <option value="grading">Grading</option>
                          <option value="demolition">Demolition</option>
                          <option value="other">Other</option>
                        </select>
                        <button onClick={() => setWorkTypes(workTypes.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setWorkTypes([...workTypes, { name: '', category: '' }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
                    <Plus size={16} /> Add Work Type
                  </button>
                </div>
              </div>
            )}

            {/* ═══ STEP 10: My Numbers Summary (KYN Phase F) ═══ */}
            {step === 10 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">My Numbers</h2>
                  <p className="text-sm text-muted-foreground">
                    Your complete KYN profile. These numbers power every estimate in BidClaw.
                  </p>
                </div>

                <div className="rounded-xl border-2 border-gold bg-gradient-to-br from-navy to-navy-light p-8 text-white">
                  <div className="mb-6 text-center">
                    <Award size={32} className="mx-auto mb-2 text-gold" />
                    <h3 className="text-xl font-bold">{companyName || 'My Company'}</h3>
                    <p className="text-xs text-white/60">Know Your Numbers Profile</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg bg-white/10 p-4 text-center">
                      <p className="text-3xl font-bold text-gold">{fmtRate(retailLaborRate)}</p>
                      <p className="text-xs text-white/70">Retail Labor Rate</p>
                    </div>
                    <div className="rounded-lg bg-white/10 p-4 text-center">
                      <p className="text-3xl font-bold text-gold">{materialMarkup}%</p>
                      <p className="text-xs text-white/70">Material Markup</p>
                    </div>
                    <div className="rounded-lg bg-white/10 p-4 text-center">
                      <p className="text-3xl font-bold text-gold">{subMarkup}%</p>
                      <p className="text-xs text-white/70">Sub Markup</p>
                    </div>
                    <div className="rounded-lg bg-white/10 p-4 text-center">
                      <p className="text-3xl font-bold text-gold">
                        {crewMen}×{crewFullHours} = {crewMen * crewFullHours} MH
                      </p>
                      <p className="text-xs text-white/70">Full Day Crew</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2 text-sm">
                    <div className="flex justify-between border-b border-white/10 pb-1">
                      <span className="text-white/70">True Cost/Billable Hour:</span>
                      <span>{fmtRate(laborCalcs.trueCostPerHour)}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/10 pb-1">
                      <span className="text-white/70">Overhead/Billable Hour:</span>
                      <span>{fmtRate(overheadCalcs.perHour)}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/10 pb-1">
                      <span className="text-white/70">Annual Overhead:</span>
                      <span>{fmt(overheadCalcs.annualTotal)}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/10 pb-1">
                      <span className="text-white/70">Target Profit:</span>
                      <span>{targetProfit}%</span>
                    </div>
                    <div className="flex justify-between border-b border-white/10 pb-1">
                      <span className="text-white/70">Disposal Markup:</span>
                      <span>{disposalMarkup}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Delivery Markup:</span>
                      <span>{deliveryMarkup}%</span>
                    </div>
                  </div>

                  <p className="mt-6 text-center text-xs text-white/50">
                    You are now pricing like Contractor B.
                  </p>
                </div>

                <div className="rounded-lg bg-gold/10 p-4 text-sm text-navy">
                  <p>
                    <strong>Ready to go.</strong> Click "Finish Setup" to save your numbers. Every estimate you create will automatically use them.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between border-t border-border bg-white px-6 py-4">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-navy disabled:opacity-30"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <span className="text-xs text-muted-foreground">
            {step + 1} / {steps.length}
          </span>

          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors"
            >
              Next
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-navy hover:bg-gold-light disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Finish Setup'}
              {!saving && <Check size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Generic catalog table component ──
function CatalogTable({
  columns, rows, onAdd, onRemove, onUpdate, fields, fieldTypes, placeholders,
}: {
  columns: string[]
  rows: Record<string, unknown>[]
  onAdd: () => void
  onRemove: (i: number) => void
  onUpdate: (i: number, field: string, value: string | number) => void
  fields: string[]
  fieldTypes: ('text' | 'number')[]
  placeholders: string[]
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      {rows.length > 0 && (
        <div className="mb-3 hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid">
          {columns.map((col) => <div key={col}>{col}</div>)}
          <div className="w-8" />
        </div>
      )}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            {fields.map((field, fi) => (
              <input
                key={field}
                type={fieldTypes[fi]}
                step={fieldTypes[fi] === 'number' ? '0.01' : undefined}
                value={(row[field] as string | number) ?? ''}
                onChange={(e) =>
                  onUpdate(i, field, fieldTypes[fi] === 'number' ? Number(e.target.value) : e.target.value)
                }
                placeholder={placeholders[fi]}
                className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
              />
            ))}
            <button onClick={() => onRemove(i)}
              className="flex items-center justify-center text-muted-foreground hover:text-destructive">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
