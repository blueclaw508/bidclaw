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

  // Step 0: Company (matching QuickCalc fields)
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')

  // Step 1: Methodology
  const [methodology, setMethodology] = useState('')
  const [chatMessages, setChatMessages] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [methodologyStarted, setMethodologyStarted] = useState(false)

  // Step 2: Production rates
  const [rates, setRates] = useState<Partial<ProductionRate>[]>(() =>
    PRODUCTION_BENCHMARKS.map((b) => ({
      work_type: b.work_type,
      unit: b.unit,
      man_hours_per_unit: b.bca_rate ?? 0,
      notes: b.verified ? 'BCA verified' : '',
    }))
  )

  // Step 3: Materials — NAME | U/M | SUPPLIER
  const [materials, setMaterials] = useState<Partial<MaterialCatalogItem>[]>([])

  // Step 4: Subs — NAME | TRADE
  const [subs, setSubs] = useState<Partial<SubCatalogItem>[]>([])

  // Step 5: Equipment — EQUIPMENT | U/M
  const [equipment, setEquipment] = useState<Partial<EquipmentItem>[]>([])

  // Step 6: Disposal — NAME | U/M
  const [disposal, setDisposal] = useState<Partial<DisposalCatalogItem>[]>([])

  // Step 7: Work Types
  const [workTypes, setWorkTypes] = useState<Partial<WorkType>[]>([])

  // ── LocalStorage persistence ──
  const STORAGE_KEY = 'bidclaw_setup_wizard'

  useEffect(() => {
    const data = {
      step, companyName, contactName, street, city, state, zip, companyEmail, companyPhone, companyWebsite,
      rates, materials, subs, equipment, disposal, workTypes,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  }, [step, companyName, contactName, street, city, state, zip, companyEmail, companyPhone, companyWebsite,
      rates, materials, subs, equipment, disposal, workTypes])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const d = JSON.parse(saved)
      if (d.step != null) setStep(d.step)
      if (d.companyName) setCompanyName(d.companyName)
      if (d.contactName) setContactName(d.contactName)
      if (d.street) setStreet(d.street)
      if (d.city) setCity(d.city)
      if (d.state) setState(d.state)
      if (d.zip) setZip(d.zip)
      if (d.companyEmail) setCompanyEmail(d.companyEmail)
      if (d.companyPhone) setCompanyPhone(d.companyPhone)
      if (d.companyWebsite) setCompanyWebsite(d.companyWebsite)
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
          contact_name: contactName || null,
          street: street || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          email: companyEmail || null,
          phone: companyPhone || null,
          website: companyWebsite || null,
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

      const validMats = materials.filter((m) => m.name)
      if (validMats.length > 0) {
        await supabase.from('materials_catalog').insert(validMats.map((m) => ({ ...m, company_id: companyId })))
      }

      const validSubs = subs.filter((s) => s.name)
      if (validSubs.length > 0) {
        await supabase.from('subs_catalog').insert(validSubs.map((s) => ({ ...s, company_id: companyId })))
      }

      const validEquip = equipment.filter((e) => e.name)
      if (validEquip.length > 0) {
        await supabase.from('equipment_catalog').insert(validEquip.map((e) => ({ ...e, company_id: companyId })))
      }

      const validDisposal = disposal.filter((d) => d.name)
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
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar stepper — ALL steps clickable */}
      <div className="hidden w-64 flex-shrink-0 overflow-y-auto p-6 md:block"
        style={{ background: 'linear-gradient(180deg, #1e3a5f 0%, #2d5aa0 100%)' }}>
        <div className="mb-8">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white font-bold text-sm">BC</div>
            <span className="text-lg font-semibold">Setup</span>
          </div>
        </div>
        <nav className="space-y-1">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <button key={i} onClick={() => setStep(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  i === step ? 'bg-white/15 text-white' : i < step ? 'text-green-300 hover:bg-white/10' : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                }`}>
                {i < step ? <Check size={16} className="text-green-300" /> : <Icon size={16} />}
                <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 md:hidden">
          <span className="text-sm font-medium text-slate-500">Step {step + 1} of {steps.length}</span>
          <span className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{steps[step].label}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="mx-auto max-w-2xl">

            {/* ═══ STEP 0: Company ═══ */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Company Information</h2>
                  <p className="text-sm text-slate-500">This info will push to QuickCalc with your first estimate.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Company Name *</label>
                      <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Your Company Name" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Contact Name</label>
                      <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Ian McCarthy" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Street Address</label>
                    <input value={street} onChange={(e) => setStreet(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="PO Box 277" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
                      <input value={city} onChange={(e) => setCity(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
                      <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="MA" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Zip</label>
                      <input value={zip} onChange={(e) => setZip(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="02101" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                      <input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="info@company.com" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                      <input type="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="508-555-0100" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Website</label>
                    <input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="www.company.com" />
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 1: Methodology ═══ */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Estimating Methodology</h2>
                  <p className="text-sm text-slate-500">Chat with AI to teach it how your company estimates. You can skip this.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {!methodologyStarted ? (
                    <div className="flex flex-col items-center justify-center p-12">
                      <MessageSquare size={48} className="mb-4 text-blue-500" />
                      <button onClick={startMethodologyChat}
                        className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                        style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
                        <MessageSquare size={16} /> Start Conversation
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="h-80 overflow-y-auto p-4 space-y-3">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
                            }`}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {chatLoading && <div className="flex justify-start"><div className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">Thinking...</div></div>}
                      </div>
                      <div className="flex gap-2 border-t border-slate-200 p-3">
                        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                          placeholder="Describe your estimating approach..."
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                        <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                          className="rounded-lg bg-blue-600 p-2 text-white disabled:opacity-50"><Send size={16} /></button>
                      </div>
                    </>
                  )}
                </div>
                {methodology && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="mb-1 text-xs font-semibold uppercase text-blue-700">AI Summary</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{methodology}</p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 2: Production Rates ═══ */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Production Rates</h2>
                  <p className="text-sm text-slate-500">Man hours per unit. BCA verified rates shown where available.</p>
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

            {/* ═══ STEP 3: Item Catalog — Materials (NAME | U/M | SUPPLIER) ═══ */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Item Catalog — Materials</h2>
                  <p className="text-sm text-slate-500">Material names and suppliers. Quantities assigned per estimate.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'U/M', 'Supplier']}
                  rows={materials} fields={['name', 'um', 'supplier']}
                  fieldTypes={['text', 'text', 'text']}
                  placeholders={['Dark Bark Mulch', 'CY', 'Landscape Express']}
                  onAdd={() => setMaterials([...materials, { name: '', um: '', supplier: '' }])}
                  onRemove={(i) => setMaterials(materials.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...materials]; (u[i] as Record<string, unknown>)[f] = v; setMaterials(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 4: Item Catalog — Subcontractors (NAME | TRADE) ═══ */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Item Catalog — Subcontractors</h2>
                  <p className="text-sm text-slate-500">Subcontractor names and trades. Costs assigned per estimate.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'Trade']}
                  rows={subs} fields={['name', 'trade']}
                  fieldTypes={['text', 'text']}
                  placeholders={['Bobcat w/ Operator', 'Excavation']}
                  onAdd={() => setSubs([...subs, { name: '', trade: '' }])}
                  onRemove={(i) => setSubs(subs.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...subs]; (u[i] as Record<string, unknown>)[f] = v; setSubs(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 5: Item Catalog — Equipment (EQUIPMENT | U/M) ═══ */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Item Catalog — Equipment</h2>
                  <p className="text-sm text-slate-500">Equipment names only. Hours assigned per estimate; QuickCalc applies rates.</p>
                </div>
                <CatalogTable
                  columns={['Equipment', 'U/M']}
                  rows={equipment} fields={['name', 'um']}
                  fieldTypes={['text', 'text']}
                  placeholders={['Dingo', 'HR']}
                  onAdd={() => setEquipment([...equipment, { name: '', um: 'HR' }])}
                  onRemove={(i) => setEquipment(equipment.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...equipment]; (u[i] as Record<string, unknown>)[f] = v; setEquipment(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 6: Item Catalog — Disposal Fees/Other (NAME | U/M) ═══ */}
            {step === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Item Catalog — Disposal Fees/Other</h2>
                  <p className="text-sm text-slate-500">Disposal fees, permit fees, delivery charges, and other billable items.</p>
                </div>
                <CatalogTable
                  columns={['Name', 'U/M']}
                  rows={disposal} fields={['name', 'um']}
                  fieldTypes={['text', 'text']}
                  placeholders={['Dump Fee', 'LOAD']}
                  onAdd={() => setDisposal([...disposal, { name: '', um: '' }])}
                  onRemove={(i) => setDisposal(disposal.filter((_, idx) => idx !== i))}
                  onUpdate={(i, f, v) => { const u = [...disposal]; (u[i] as Record<string, unknown>)[f] = v; setDisposal(u) }}
                />
              </div>
            )}

            {/* ═══ STEP 7: Work Types ═══ */}
            {step === 7 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>Work Types Library</h2>
                  <p className="text-sm text-slate-500">Define the types of work your company does.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="space-y-3">
                    {workTypes.map((wt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input value={wt.name ?? ''} onChange={(e) => { const u = [...workTypes]; u[i] = { ...u[i], name: e.target.value }; setWorkTypes(u) }}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Work type name" />
                        <select value={wt.category ?? ''} onChange={(e) => { const u = [...workTypes]; u[i] = { ...u[i], category: e.target.value }; setWorkTypes(u) }}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
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
                          className="text-slate-400 hover:text-red-500" aria-label="Remove"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setWorkTypes([...workTypes, { name: '', category: '' }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"><Plus size={16} /> Add Work Type</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4">
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-30">
            <ChevronLeft size={16} /> Back
          </button>
          <span className="text-xs text-slate-400">{step + 1} / {steps.length}</span>
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={handleFinish} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
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
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      {rows.length > 0 && (
        <div className={`mb-3 hidden gap-2 text-xs font-medium uppercase text-slate-500 sm:grid`}
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
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            ))}
            <button onClick={() => onRemove(i)} className="flex items-center justify-center text-slate-400 hover:text-red-500" aria-label="Remove">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800">
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
