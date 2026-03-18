import { useState, useEffect } from 'react'
import { supabase, invokeEdgeFunction } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  ProductionRate,
  MaterialCatalogItem,
  SubCatalogItem,
  EquipmentItem,
  DisposalCatalogItem,
  WorkType,
  AiMessage,
} from '@/lib/types'
import { PRODUCTION_BENCHMARKS } from '@/lib/types'
import {
  Building2,
  Users,
  MessageSquare,
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
  Receipt,
} from 'lucide-react'

interface SetupWizardProps {
  onComplete: () => void
}

const steps = [
  { label: 'Company', icon: Building2 },
  { label: 'Crew', icon: Users },
  { label: 'Methodology', icon: MessageSquare },
  { label: 'Production Rates', icon: Gauge },
  { label: 'Item Catalog — Materials', icon: Package },
  { label: 'Item Catalog — Subs', icon: Wrench },
  { label: 'Item Catalog — Equipment', icon: Truck },
  { label: 'Item Catalog — Disposal', icon: Receipt },
  { label: 'Work Types', icon: Layers },
]

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { user, refreshCompany } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 0: Company
  const [companyName, setCompanyName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')

  // Step 1: Crew
  const [crewSize, setCrewSize] = useState(3)
  const [crewFullHours, setCrewFullHours] = useState(9)
  const [crewHalfHours, setCrewHalfHours] = useState(4.5)

  // Step 2: Methodology
  const [methodology, setMethodology] = useState('')
  const [chatMessages, setChatMessages] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [methodologyStarted, setMethodologyStarted] = useState(false)

  // Step 3: Production rates
  const [rates, setRates] = useState<Partial<ProductionRate>[]>(() =>
    PRODUCTION_BENCHMARKS.map((b) => ({
      work_type: b.work_type,
      unit: b.unit,
      man_hours_per_unit: b.bca_rate ?? 0,
      notes: b.verified ? 'BCA verified' : '',
    }))
  )

  // Step 4: Materials
  const [materials, setMaterials] = useState<Partial<MaterialCatalogItem>[]>([])

  // Step 5: Subs
  const [subs, setSubs] = useState<Partial<SubCatalogItem>[]>([])

  // Step 6: Equipment
  const [equipment, setEquipment] = useState<Partial<EquipmentItem>[]>([])

  // Step 7: Disposal
  const [disposal, setDisposal] = useState<Partial<DisposalCatalogItem>[]>([])

  // Step 8: Work Types
  const [workTypes, setWorkTypes] = useState<Partial<WorkType>[]>([])

  // ── LocalStorage persistence ──
  const STORAGE_KEY = 'bidclaw_setup_wizard'

  useEffect(() => {
    const data = {
      step, companyName, street, city, state, zip, crewSize, crewFullHours, crewHalfHours,
      rates, materials, subs, equipment, disposal, workTypes,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  }, [step, companyName, street, city, state, zip, crewSize, crewFullHours, crewHalfHours,
      rates, materials, subs, equipment, disposal, workTypes])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const d = JSON.parse(saved)
      if (d.step != null) setStep(d.step)
      if (d.companyName) setCompanyName(d.companyName)
      if (d.street) setStreet(d.street)
      if (d.city) setCity(d.city)
      if (d.state) setState(d.state)
      if (d.zip) setZip(d.zip)
      if (d.crewSize) setCrewSize(d.crewSize)
      if (d.crewFullHours) setCrewFullHours(d.crewFullHours)
      if (d.crewHalfHours) setCrewHalfHours(d.crewHalfHours)
      if (d.rates?.length) setRates(d.rates)
      if (d.materials?.length) setMaterials(d.materials)
      if (d.subs?.length) setSubs(d.subs)
      if (d.equipment?.length) setEquipment(d.equipment)
      if (d.disposal?.length) setDisposal(d.disposal)
      if (d.workTypes?.length) setWorkTypes(d.workTypes)
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearSavedProgress = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  // ── Methodology chat ──
  const startMethodologyChat = () => {
    setMethodologyStarted(true)
    setChatMessages([{
      role: 'assistant',
      content: "Tell me about the types of work your company does and how you typically estimate jobs. What trades do you cover? What's your typical project size and region?",
    }])
  }

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
        { action: 'methodology_chat', payload: { messages: newMessages, company_name: companyName } }
      )
      if (error) throw new Error(error)
      setChatMessages([...newMessages, { role: 'assistant', content: data?.message ?? 'I understand.' }])
      if (data?.methodology) setMethodology(data.methodology)
    } catch {
      setChatMessages([...newMessages, { role: 'assistant', content: 'Connection issue. You can skip this and come back later.' }])
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
          street: street || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          typical_crew_size: crewSize,
          crew_full_day_hours: crewFullHours,
          crew_half_day_hours: crewHalfHours,
          estimating_methodology: methodology || null,
        })
        .select('id')
        .single()

      if (companyErr) throw new Error(companyErr.message)
      const companyId = companyData.id

      const validRates = rates.filter((r) => r.work_type && r.unit && r.man_hours_per_unit)
      if (validRates.length > 0) {
        await supabase.from('production_rates').insert(validRates.map((r) => ({ ...r, company_id: companyId })))
      }

      const validMats = materials.filter((m) => m.name && m.unit && m.unit_cost)
      if (validMats.length > 0) {
        await supabase.from('materials_catalog').insert(validMats.map((m) => ({ ...m, company_id: companyId })))
      }

      const validSubs = subs.filter((s) => s.name && s.unit && s.unit_cost)
      if (validSubs.length > 0) {
        await supabase.from('subs_catalog').insert(validSubs.map((s) => ({ ...s, company_id: companyId })))
      }

      const validEquip = equipment.filter((e) => e.name)
      if (validEquip.length > 0) {
        await supabase.from('equipment_catalog').insert(validEquip.map((e) => ({ ...e, company_id: companyId })))
      }

      const validDisposal = disposal.filter((d) => d.name && d.unit && d.unit_cost)
      if (validDisposal.length > 0) {
        await supabase.from('disposal_catalog').insert(validDisposal.map((d) => ({ ...d, company_id: companyId })))
      }

      const validTypes = workTypes.filter((w) => w.name && w.category)
      if (validTypes.length > 0) {
        await supabase.from('work_types').insert(validTypes.map((w) => ({ ...w, company_id: companyId })))
      }

      await refreshCompany()
      clearSavedProgress()
      toast.success('Setup complete!')
      onComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const canNext = step === 0 ? companyName.trim().length > 0 : true

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar stepper */}
      <div className="hidden w-64 flex-shrink-0 overflow-y-auto bg-navy p-6 md:block">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-navy font-bold text-sm">BC</div>
            <span className="text-lg font-semibold">Setup</span>
          </div>
        </div>
        <nav className="space-y-1">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <button key={i} onClick={() => i <= step && setStep(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  i === step ? 'bg-white/10 text-white' : i < step ? 'text-gold cursor-pointer hover:bg-white/5' : 'text-white/30 cursor-default'
                }`}>
                {i < step ? <Check size={16} className="text-gold" /> : <Icon size={16} />}
                <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3 md:hidden">
          <span className="text-sm font-medium text-muted-foreground">Step {step + 1} of {steps.length}</span>
          <span className="text-sm font-semibold text-navy">{steps[step].label}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="mx-auto max-w-2xl">

            {/* ═══ STEP 0: Company ═══ */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Company Information</h2>
                  <p className="text-sm text-muted-foreground">Tell us about your company.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Company Name *</label>
                    <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" placeholder="Your Company Name" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Street Address</label>
                    <input value={street} onChange={(e) => setStreet(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" placeholder="123 Main St" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium">City</label>
                      <input value={city} onChange={(e) => setCity(e.target.value)}
                        className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">State</label>
                      <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2}
                        className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" placeholder="MA" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Zip</label>
                      <input value={zip} onChange={(e) => setZip(e.target.value)}
                        className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" placeholder="02101" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 1: Crew ═══ */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Crew Defaults</h2>
                  <p className="text-sm text-muted-foreground">Set your standard crew configuration for labor day calculations.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Typical Crew Size</label>
                    <input type="number" min={1} value={crewSize} onChange={(e) => setCrewSize(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Full Day Hours</label>
                    <input type="number" step={0.5} value={crewFullHours} onChange={(e) => setCrewFullHours(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Half Day Hours</label>
                    <input type="number" step={0.5} value={crewHalfHours} onChange={(e) => setCrewHalfHours(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
                  </div>
                  <div className="rounded-lg bg-navy/5 p-3 text-sm">
                    <strong>Full day:</strong> {crewSize} × {crewFullHours} = {crewSize * crewFullHours} MH
                    <span className="mx-3 text-border">|</span>
                    <strong>Half day:</strong> {crewSize} × {crewHalfHours} = {crewSize * crewHalfHours} MH
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 2: Methodology ═══ */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Estimating Methodology</h2>
                  <p className="text-sm text-muted-foreground">Chat with AI to teach it how your company estimates. You can skip this.</p>
                </div>
                <div className="rounded-xl border border-border bg-white overflow-hidden">
                  {!methodologyStarted ? (
                    <div className="flex flex-col items-center justify-center p-12">
                      <MessageSquare size={48} className="mb-4 text-gold" />
                      <button onClick={startMethodologyChat}
                        className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-light transition-colors">
                        <MessageSquare size={16} /> Start Conversation
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="h-80 overflow-y-auto p-4 space-y-3">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-navy text-white' : 'bg-muted text-foreground'}`}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {chatLoading && <div className="flex justify-start"><div className="rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Thinking...</div></div>}
                      </div>
                      <div className="flex gap-2 border-t border-border p-3">
                        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                          placeholder="Describe your estimating approach..."
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
                        <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                          className="rounded-lg bg-navy p-2 text-white disabled:opacity-50"><Send size={16} /></button>
                      </div>
                    </>
                  )}
                </div>
                {methodology && (
                  <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
                    <p className="mb-1 text-xs font-semibold uppercase text-gold-dark">AI Summary</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{methodology}</p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 3: Production Rates ═══ */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Production Rates</h2>
                  <p className="text-sm text-muted-foreground">Man hours per unit. BCA verified rates shown where available.</p>
                </div>
                <CatalogTable
                  columns={['Work Type', 'Unit', 'MH/Unit', 'Notes']}
                  rows={rates} fields={['work_type', 'unit', 'man_hours_per_unit', 'notes']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Mulch Install', 'CY', '1.5', 'Notes']}
                  onAdd={() => setRates([...rates, { work_type: '', unit: '', man_hours_per_unit: 0, notes: '' }])}
                  onRemove={(i) => setRates(rates.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...rates]; (u[i] as Record<string, unknown>)[f] = v; setRates(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 4: Item Catalog — Materials ═══ */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Item Catalog — Materials</h2>
                  <p className="text-sm text-muted-foreground">Raw material costs (what you pay — no markup).</p>
                </div>
                <CatalogTable
                  columns={['Name', 'U/M', 'Unit', 'Unit Cost', 'Supplier']}
                  rows={materials} fields={['name', 'um', 'unit', 'unit_cost', 'supplier']}
                  fieldTypes={['text', 'text', 'text', 'number', 'text']}
                  placeholders={['Dark Bark Mulch', 'CY', 'CY', '45.00', 'Supplier']}
                  onAdd={() => setMaterials([...materials, { name: '', um: '', unit: '', unit_cost: 0, supplier: '' }])}
                  onRemove={(i) => setMaterials(materials.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...materials]; (u[i] as Record<string, unknown>)[f] = v; setMaterials(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 5: Item Catalog — Subcontractors ═══ */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Item Catalog — Subcontractors</h2>
                  <p className="text-sm text-muted-foreground">What subs charge you (no markup).</p>
                </div>
                <CatalogTable
                  columns={['Name', 'U/M', 'Unit', 'Unit Cost', 'Trade']}
                  rows={subs} fields={['name', 'um', 'unit', 'unit_cost', 'trade']}
                  fieldTypes={['text', 'text', 'text', 'number', 'text']}
                  placeholders={['Bobcat w/ Operator', 'HR', 'HR', '125.00', 'Excavation']}
                  onAdd={() => setSubs([...subs, { name: '', um: '', unit: '', unit_cost: 0, trade: '' }])}
                  onRemove={(i) => setSubs(subs.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...subs]; (u[i] as Record<string, unknown>)[f] = v; setSubs(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 6: Item Catalog — Equipment ═══ */}
            {step === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Item Catalog — Equipment</h2>
                  <p className="text-sm text-muted-foreground">Equipment names only. Hours assigned per estimate; QuickCalc applies rates.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {equipment.map((item, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input value={item.name ?? ''} onChange={(e) => { const u = [...equipment]; u[i] = { ...u[i], name: e.target.value }; setEquipment(u) }}
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Equipment name" />
                        <button onClick={() => setEquipment(equipment.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEquipment([...equipment, { name: '', billable: true }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"><Plus size={16} /> Add Equipment</button>
                </div>
              </div>
            )}

            {/* ═══ STEP 7: Item Catalog — Disposal Fees/Other ═══ */}
            {step === 7 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Item Catalog — Disposal Fees/Other</h2>
                  <p className="text-sm text-muted-foreground">Disposal fees, permit fees, delivery charges, and other billable items.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'U/M', 'Unit', 'Unit Cost']}
                  rows={disposal} fields={['name', 'um', 'unit', 'unit_cost']}
                  fieldTypes={['text', 'text', 'text', 'number']}
                  placeholders={['Dump Fee', 'LOAD', 'LOAD', '250.00']}
                  onAdd={() => setDisposal([...disposal, { name: '', um: '', unit: '', unit_cost: 0 }])}
                  onRemove={(i) => setDisposal(disposal.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...disposal]; (u[i] as Record<string, unknown>)[f] = v; setDisposal(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 8: Work Types ═══ */}
            {step === 8 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Work Types Library</h2>
                  <p className="text-sm text-muted-foreground">Define the types of work your company does.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {workTypes.map((wt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input value={wt.name ?? ''} onChange={(e) => { const u = [...workTypes]; u[i] = { ...u[i], name: e.target.value }; setWorkTypes(u) }}
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Work type name" />
                        <select value={wt.category ?? ''} onChange={(e) => { const u = [...workTypes]; u[i] = { ...u[i], category: e.target.value }; setWorkTypes(u) }}
                          className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold">
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
                          className="text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setWorkTypes([...workTypes, { name: '', category: '' }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"><Plus size={16} /> Add Work Type</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between border-t border-border bg-white px-6 py-4">
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-navy disabled:opacity-30">
            <ChevronLeft size={16} /> Back
          </button>
          <span className="text-xs text-muted-foreground">{step + 1} / {steps.length}</span>
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext}
              className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors">
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={handleFinish} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-navy hover:bg-gold-light disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Finish Setup'} {!saving && <Check size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Generic catalog table ──
function CatalogTable({ columns, rows, onAdd, onRemove, onUpdate, fields, fieldTypes, placeholders }: {
  columns: string[]; rows: Record<string, unknown>[]; onAdd: () => void; onRemove: (i: number) => void
  onUpdate: (i: number, field: string, value: string | number) => void
  fields: string[]; fieldTypes: ('text' | 'number')[]; placeholders: string[]
}) {
  const colTemplate = fields.map(() => '1fr').join(' ') + ' auto'
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      {rows.length > 0 && (
        <div className={`mb-3 hidden gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid`}
          style={{ gridTemplateColumns: colTemplate }}>
          {columns.map((col) => <div key={col}>{col}</div>)}
          <div className="w-8" />
        </div>
      )}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2" style={{ gridTemplateColumns: colTemplate }}>
            {fields.map((field, fi) => (
              <input key={field} type={fieldTypes[fi]} step={fieldTypes[fi] === 'number' ? '0.01' : undefined}
                value={(row[field] as string | number) ?? ''} placeholder={placeholders[fi]}
                onChange={(e) => onUpdate(i, field, fieldTypes[fi] === 'number' ? Number(e.target.value) : e.target.value)}
                className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
            ))}
            <button onClick={() => onRemove(i)} className="flex items-center justify-center text-muted-foreground hover:text-destructive" aria-label="Remove">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
