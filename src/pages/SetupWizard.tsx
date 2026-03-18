import { useState, useCallback } from 'react'
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
  Sparkles,
} from 'lucide-react'

interface SetupWizardProps {
  onComplete: () => void
}

const steps = [
  { label: 'Company', icon: Building2 },
  { label: 'Crew', icon: Users },
  { label: 'Methodology', icon: MessageSquare },
  { label: 'Rates', icon: Gauge },
  { label: 'Materials', icon: Package },
  { label: 'Subs', icon: Wrench },
  { label: 'Equipment', icon: Truck },
  { label: 'Work Types', icon: Layers },
]

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { user, refreshCompany } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1: Company
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')

  // Step 2: Crew
  const [crewMen, setCrewMen] = useState(3)
  const [crewFullHours, setCrewFullHours] = useState(9)
  const [crewHalfHours, setCrewHalfHours] = useState(4.5)

  // Step 3: Methodology
  const [methodology, setMethodology] = useState('')
  const [chatMessages, setChatMessages] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [methodologyStarted, setMethodologyStarted] = useState(false)

  // Step 4: Production rates
  const [rates, setRates] = useState<Partial<ProductionRate>[]>([])

  // Step 5: Materials
  const [materials, setMaterials] = useState<Partial<MaterialCatalogItem>[]>([])

  // Step 6: Subs
  const [subs, setSubs] = useState<Partial<SubCatalogItem>[]>([])

  // Step 7: Equipment
  const [equipment, setEquipment] = useState<Partial<EquipmentItem>[]>([])

  // Step 8: Work types
  const [workTypes, setWorkTypes] = useState<Partial<WorkType>[]>([])

  // ── Methodology chat ──
  const startMethodologyChat = useCallback(async () => {
    setMethodologyStarted(true)
    const initialMsg: AiMessage = {
      role: 'assistant',
      content:
        "Tell me about the types of work your company does and how you typically estimate jobs. What trades do you cover? What's your typical project size and region?",
    }
    setChatMessages([initialMsg])
  }, [])

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
        content: data?.message ?? 'I understand. Let me summarize what I learned.',
      }
      setChatMessages([...newMessages, assistantMsg])
      if (data?.methodology) {
        setMethodology(data.methodology)
      }
    } catch {
      setChatMessages([
        ...newMessages,
        { role: 'assistant', content: 'Sorry, I had trouble connecting. You can skip this step and come back later.' },
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
      // 1. Create company
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
        })
        .select('id')
        .single()

      if (companyErr) throw new Error(companyErr.message)
      const companyId = companyData.id

      // 2. Insert production rates
      const validRates = rates.filter((r) => r.work_type && r.unit && r.man_hours_per_unit)
      if (validRates.length > 0) {
        await supabase.from('production_rates').insert(
          validRates.map((r) => ({ ...r, company_id: companyId }))
        )
      }

      // 3. Insert materials
      const validMats = materials.filter((m) => m.name && m.unit && m.unit_cost)
      if (validMats.length > 0) {
        await supabase.from('materials_catalog').insert(
          validMats.map((m) => ({ ...m, company_id: companyId }))
        )
      }

      // 4. Insert subs
      const validSubs = subs.filter((s) => s.name && s.unit && s.unit_cost)
      if (validSubs.length > 0) {
        await supabase.from('subs_catalog').insert(
          validSubs.map((s) => ({ ...s, company_id: companyId }))
        )
      }

      // 5. Insert equipment
      const validEquip = equipment.filter((e) => e.name)
      if (validEquip.length > 0) {
        await supabase.from('equipment_catalog').insert(
          validEquip.map((e) => ({ ...e, company_id: companyId }))
        )
      }

      // 6. Insert work types
      const validTypes = workTypes.filter((w) => w.name && w.category)
      if (validTypes.length > 0) {
        await supabase.from('work_types').insert(
          validTypes.map((w) => ({ ...w, company_id: companyId }))
        )
      }

      await refreshCompany()
      onComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const canNext =
    step === 0 ? companyName.trim().length > 0 :
    step === 1 ? crewMen > 0 :
    true

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar stepper */}
      <div className="hidden w-64 flex-shrink-0 bg-navy p-6 md:block">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-navy font-bold text-sm">
              BC
            </div>
            <span className="text-lg font-semibold">Setup</span>
          </div>
        </div>
        <nav className="space-y-1">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <button
                key={i}
                onClick={() => i <= step && setStep(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  i === step
                    ? 'bg-white/10 text-white'
                    : i < step
                    ? 'text-gold cursor-pointer hover:bg-white/5'
                    : 'text-white/30 cursor-default'
                }`}
              >
                {i < step ? (
                  <Check size={18} className="text-gold" />
                ) : (
                  <Icon size={18} />
                )}
                {s.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Mobile step indicator */}
        <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3 md:hidden">
          <span className="text-sm font-medium text-muted-foreground">
            Step {step + 1} of {steps.length}
          </span>
          <span className="text-sm font-semibold text-navy">{steps[step].label}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="mx-auto max-w-2xl">
            {/* Step 1: Company */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Company Information</h2>
                  <p className="text-sm text-muted-foreground">Tell us about your company.</p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Company Name *</label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      placeholder="Your Company Name"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Address</label>
                    <input
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      placeholder="123 Main St, Anytown, MA 02101"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Crew */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Crew Defaults</h2>
                  <p className="text-sm text-muted-foreground">
                    Set your standard crew configuration. These are used to calculate labor days.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Crew Size (men)</label>
                    <input
                      type="number"
                      min={1}
                      value={crewMen}
                      onChange={(e) => setCrewMen(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Full Day Hours</label>
                    <input
                      type="number"
                      step={0.5}
                      min={1}
                      value={crewFullHours}
                      onChange={(e) => setCrewFullHours(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Half Day Hours</label>
                    <input
                      type="number"
                      step={0.5}
                      min={1}
                      value={crewHalfHours}
                      onChange={(e) => setCrewHalfHours(Number(e.target.value))}
                      className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    />
                  </div>
                  <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                    <p>
                      <strong>Full day:</strong> {crewMen} men x {crewFullHours} hrs = {crewMen * crewFullHours} man-hours
                    </p>
                    <p>
                      <strong>Half day:</strong> {crewMen} men x {crewHalfHours} hrs = {crewMen * crewHalfHours} man-hours
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Methodology */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Estimating Methodology</h2>
                  <p className="text-sm text-muted-foreground">
                    Chat with AI to teach it how your company estimates jobs. You can skip this and come back later.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white overflow-hidden">
                  {!methodologyStarted ? (
                    <div className="flex flex-col items-center justify-center p-12">
                      <Sparkles size={48} className="mb-4 text-gold" />
                      <p className="mb-4 text-center text-sm text-muted-foreground">
                        Start a conversation with AI to teach it your estimating approach.
                      </p>
                      <button
                        onClick={startMethodologyChat}
                        className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-light transition-colors"
                      >
                        <MessageSquare size={16} />
                        Start Conversation
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="h-80 overflow-y-auto p-4 space-y-3">
                        {chatMessages.map((msg, i) => (
                          <div
                            key={i}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                                msg.role === 'user'
                                  ? 'bg-navy text-white'
                                  : 'bg-muted text-foreground'
                              }`}
                            >
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                              Thinking...
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 border-t border-border p-3">
                        <input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                          placeholder="Describe your estimating approach..."
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                        />
                        <button
                          onClick={sendChatMessage}
                          disabled={chatLoading || !chatInput.trim()}
                          className="rounded-lg bg-navy p-2 text-white disabled:opacity-50"
                        >
                          <Send size={16} />
                        </button>
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

            {/* Step 4: Production Rates */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Production Rates</h2>
                  <p className="text-sm text-muted-foreground">
                    Enter your known production rates. You can always add more later.
                  </p>
                </div>
                <CatalogTable
                  columns={['Work Type', 'Unit', 'MH/Unit', 'Notes']}
                  rows={rates}
                  onAdd={() => setRates([...rates, { work_type: '', unit: '', man_hours_per_unit: 0, notes: '' }])}
                  onRemove={(i) => setRates(rates.filter((_, idx) => idx !== i))}
                  onUpdate={(i, field, value) => {
                    const updated = [...rates]
                    ;(updated[i] as Record<string, unknown>)[field] = value
                    setRates(updated)
                  }}
                  fields={['work_type', 'unit', 'man_hours_per_unit', 'notes']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Mulch Install', 'CY', '0.5', 'Optional notes']}
                />
              </div>
            )}

            {/* Step 5: Materials */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Materials Catalog</h2>
                  <p className="text-sm text-muted-foreground">
                    Add materials with unit costs. This helps AI estimate material costs accurately.
                  </p>
                </div>
                <CatalogTable
                  columns={['Name', 'Unit', 'Unit Cost', 'Supplier']}
                  rows={materials}
                  onAdd={() => setMaterials([...materials, { name: '', unit: '', unit_cost: 0, supplier: '' }])}
                  onRemove={(i) => setMaterials(materials.filter((_, idx) => idx !== i))}
                  onUpdate={(i, field, value) => {
                    const updated = [...materials]
                    ;(updated[i] as Record<string, unknown>)[field] = value
                    setMaterials(updated)
                  }}
                  fields={['name', 'unit', 'unit_cost', 'supplier']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Dark Bark Mulch', 'CY', '45.00', 'Supplier name']}
                />
              </div>
            )}

            {/* Step 6: Subs */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Subcontractor Catalog</h2>
                  <p className="text-sm text-muted-foreground">
                    Add sub costs for work you typically sub out.
                  </p>
                </div>
                <CatalogTable
                  columns={['Name', 'Unit', 'Unit Cost', 'Trade']}
                  rows={subs}
                  onAdd={() => setSubs([...subs, { name: '', unit: '', unit_cost: 0, trade: '' }])}
                  onRemove={(i) => setSubs(subs.filter((_, idx) => idx !== i))}
                  onUpdate={(i, field, value) => {
                    const updated = [...subs]
                    ;(updated[i] as Record<string, unknown>)[field] = value
                    setSubs(updated)
                  }}
                  fields={['name', 'unit', 'unit_cost', 'trade']}
                  fieldTypes={['text', 'text', 'number', 'text']}
                  placeholders={['Bobcat w/ Operator', 'HR', '125.00', 'Excavation']}
                />
              </div>
            )}

            {/* Step 7: Equipment */}
            {step === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Equipment List</h2>
                  <p className="text-sm text-muted-foreground">
                    List equipment your company uses on jobs.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {equipment.map((item, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input
                          value={item.name ?? ''}
                          onChange={(e) => {
                            const updated = [...equipment]
                            updated[i] = { ...updated[i], name: e.target.value }
                            setEquipment(updated)
                          }}
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                          placeholder="Equipment name"
                        />
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={item.billable ?? true}
                            onChange={(e) => {
                              const updated = [...equipment]
                              updated[i] = { ...updated[i], billable: e.target.checked }
                              setEquipment(updated)
                            }}
                            className="rounded"
                          />
                          Billable
                        </label>
                        <button
                          onClick={() => setEquipment(equipment.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setEquipment([...equipment, { name: '', billable: true }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
                  >
                    <Plus size={16} />
                    Add Equipment
                  </button>
                </div>
              </div>
            )}

            {/* Step 8: Work Types */}
            {step === 7 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-navy">Work Types Library</h2>
                  <p className="text-sm text-muted-foreground">
                    Define the types of work your company does.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-white p-6">
                  <div className="space-y-3">
                    {workTypes.map((wt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input
                          value={wt.name ?? ''}
                          onChange={(e) => {
                            const updated = [...workTypes]
                            updated[i] = { ...updated[i], name: e.target.value }
                            setWorkTypes(updated)
                          }}
                          className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                          placeholder="Work type name"
                        />
                        <select
                          value={wt.category ?? ''}
                          onChange={(e) => {
                            const updated = [...workTypes]
                            updated[i] = { ...updated[i], category: e.target.value }
                            setWorkTypes(updated)
                          }}
                          className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                        >
                          <option value="">Category</option>
                          <option value="hardscape">Hardscape</option>
                          <option value="planting">Planting</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="irrigation">Irrigation</option>
                          <option value="grading">Grading</option>
                          <option value="demolition">Demolition</option>
                          <option value="other">Other</option>
                        </select>
                        <button
                          onClick={() => setWorkTypes(workTypes.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setWorkTypes([...workTypes, { name: '', category: '' }])}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
                  >
                    <Plus size={16} />
                    Add Work Type
                  </button>
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
  columns,
  rows,
  onAdd,
  onRemove,
  onUpdate,
  fields,
  fieldTypes,
  placeholders,
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
          {columns.map((col) => (
            <div key={col}>{col}</div>
          ))}
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
            <button
              onClick={() => onRemove(i)}
              className="flex items-center justify-center text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
      >
        <Plus size={16} />
        Add Row
      </button>
    </div>
  )
}
