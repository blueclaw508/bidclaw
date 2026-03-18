import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  ProductionRate,
  MaterialCatalogItem,
  SubCatalogItem,
  EquipmentItem,
  WorkType,
} from '@/lib/types'
import {
  Building2,
  Users,
  Gauge,
  Package,
  Wrench,
  Truck,
  Layers,
  Save,
  Plus,
  Upload,
} from 'lucide-react'
import { ConfirmDelete } from '@/components/ConfirmDelete'

type Tab = 'company' | 'crew' | 'kyn' | 'rates' | 'materials' | 'subs' | 'equipment' | 'work-types'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={16} /> },
  { id: 'crew', label: 'Crew', icon: <Users size={16} /> },
  { id: 'kyn', label: 'My Numbers', icon: <Gauge size={16} /> },
  { id: 'rates', label: 'Rates', icon: <Gauge size={16} /> },
  { id: 'materials', label: 'Materials', icon: <Package size={16} /> },
  { id: 'subs', label: 'Subs', icon: <Wrench size={16} /> },
  { id: 'equipment', label: 'Equipment', icon: <Truck size={16} /> },
  { id: 'work-types', label: 'Work Types', icon: <Layers size={16} /> },
]

export function Settings() {
  const { company, refreshCompany } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('company')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Company
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [crewMen, setCrewMen] = useState(3)
  const [crewFullHours, setCrewFullHours] = useState(9)
  const [crewHalfHours, setCrewHalfHours] = useState(4.5)

  // KYN Numbers
  const [baseWage, setBaseWage] = useState(0)
  const [payrollTaxRate, setPayrollTaxRate] = useState(12)
  const [workersCompRate, setWorkersCompRate] = useState(12)
  const [targetProfit, setTargetProfit] = useState(15)
  const [materialMarkup, setMaterialMarkup] = useState(25)
  const [subMarkup, setSubMarkup] = useState(15)
  const [retailRate, setRetailRate] = useState(0)

  // Catalogs
  const [rates, setRates] = useState<ProductionRate[]>([])
  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([])
  const [subs, setSubs] = useState<SubCatalogItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])

  useEffect(() => {
    if (!company) return
    setCompanyName(company.name)
    setCompanyAddress(company.address ?? '')
    setLogoUrl(company.logo_url)
    setBaseWage(company.base_hourly_wage ?? 0)
    setPayrollTaxRate(company.payroll_tax_rate)
    setWorkersCompRate(company.workers_comp_rate)
    setTargetProfit(company.target_profit_percent)
    setMaterialMarkup(company.material_markup_percent)
    setSubMarkup(company.sub_markup_percent)
    setRetailRate(company.retail_labor_rate ?? 0)
    setCrewMen(company.crew_full_day_men)
    setCrewFullHours(company.crew_full_day_hours)
    setCrewHalfHours(company.crew_half_day_hours)

    const load = async () => {
      const [r, m, s, e, w] = await Promise.all([
        supabase.from('production_rates').select('*').eq('company_id', company.id),
        supabase.from('materials_catalog').select('*').eq('company_id', company.id),
        supabase.from('subs_catalog').select('*').eq('company_id', company.id),
        supabase.from('equipment_catalog').select('*').eq('company_id', company.id),
        supabase.from('work_types').select('*').eq('company_id', company.id),
      ])
      setRates(r.data ?? [])
      setMaterials(m.data ?? [])
      setSubs(s.data ?? [])
      setEquipment(e.data ?? [])
      setWorkTypes(w.data ?? [])
    }
    load()
  }, [company])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !company) return
    setLogoUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${company.user_id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('logos')
        .upload(path, file)
      if (uploadErr) throw new Error(uploadErr.message)
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path)
      await supabase.from('companies').update({ logo_url: urlData.publicUrl }).eq('id', company.id)
      setLogoUrl(urlData.publicUrl)
      await refreshCompany()
      toast.success('Logo uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  const saveCompany = async () => {
    if (!company) return
    setSaving(true)
    await supabase.from('companies').update({
      name: companyName,
      address: companyAddress || null,
      crew_full_day_men: crewMen,
      crew_full_day_hours: crewFullHours,
      crew_half_day_hours: crewHalfHours,
    }).eq('id', company.id)
    await refreshCompany()
    setSaving(false)
    setSaved(true)
    toast.success('Company settings saved')
    setTimeout(() => setSaved(false), 2000)
  }

  // Generic add/remove for catalog items
  const addRate = async () => {
    if (!company) return
    const { data } = await supabase.from('production_rates').insert({
      company_id: company.id, work_type: '', unit: '', man_hours_per_unit: 0,
    }).select('*').single()
    if (data) setRates([...rates, data])
  }

  const removeRate = async (id: string) => {
    await supabase.from('production_rates').delete().eq('id', id)
    setRates(rates.filter((r) => r.id !== id))
  }

  const updateRate = async (id: string, field: string, value: string | number) => {
    await supabase.from('production_rates').update({ [field]: value }).eq('id', id)
    setRates(rates.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const addMaterial = async () => {
    if (!company) return
    const { data } = await supabase.from('materials_catalog').insert({
      company_id: company.id, name: '', unit: '', unit_cost: 0,
    }).select('*').single()
    if (data) setMaterials([...materials, data])
  }

  const removeMaterial = async (id: string) => {
    await supabase.from('materials_catalog').delete().eq('id', id)
    setMaterials(materials.filter((m) => m.id !== id))
  }

  const updateMaterial = async (id: string, field: string, value: string | number) => {
    await supabase.from('materials_catalog').update({ [field]: value }).eq('id', id)
    setMaterials(materials.map((m) => (m.id === id ? { ...m, [field]: value } : m)))
  }

  const addSub = async () => {
    if (!company) return
    const { data } = await supabase.from('subs_catalog').insert({
      company_id: company.id, name: '', unit: '', unit_cost: 0,
    }).select('*').single()
    if (data) setSubs([...subs, data])
  }

  const removeSub = async (id: string) => {
    await supabase.from('subs_catalog').delete().eq('id', id)
    setSubs(subs.filter((s) => s.id !== id))
  }

  const updateSub = async (id: string, field: string, value: string | number) => {
    await supabase.from('subs_catalog').update({ [field]: value }).eq('id', id)
    setSubs(subs.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }

  const addEquipment = async () => {
    if (!company) return
    const { data } = await supabase.from('equipment_catalog').insert({
      company_id: company.id, name: '', billable: true,
    }).select('*').single()
    if (data) setEquipment([...equipment, data])
  }

  const removeEquipment = async (id: string) => {
    await supabase.from('equipment_catalog').delete().eq('id', id)
    setEquipment(equipment.filter((e) => e.id !== id))
  }

  const updateEquipment = async (id: string, field: string, value: string | boolean) => {
    await supabase.from('equipment_catalog').update({ [field]: value }).eq('id', id)
    setEquipment(equipment.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  const addWorkType = async () => {
    if (!company) return
    const { data } = await supabase.from('work_types').insert({
      company_id: company.id, name: '', category: 'other',
    }).select('*').single()
    if (data) setWorkTypes([...workTypes, data])
  }

  const removeWorkType = async (id: string) => {
    await supabase.from('work_types').delete().eq('id', id)
    setWorkTypes(workTypes.filter((w) => w.id !== id))
  }

  const updateWorkType = async (id: string, field: string, value: string) => {
    await supabase.from('work_types').update({ [field]: value }).eq('id', id)
    setWorkTypes(workTypes.map((w) => (w.id === id ? { ...w, [field]: value } : w)))
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="mb-6 text-2xl font-bold text-navy">Settings</h2>

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-navy text-white'
                : 'bg-white text-muted-foreground hover:bg-muted'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Company tab */}
      {activeTab === 'company' && (
        <div className="rounded-xl border border-border bg-white p-6 space-y-4">
          {/* Logo */}
          <div>
            <label className="mb-2 block text-sm font-medium">Company Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Company logo"
                  className="h-16 w-16 rounded-lg border border-border object-contain bg-muted/30"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 text-muted-foreground">
                  <Upload size={20} />
                </div>
              )}
              <div>
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Upload size={14} />
                  {logoUploading ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,.webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <p className="mt-1 text-xs text-muted-foreground">PNG, JPG, SVG. Max 2MB.</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Company Name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Address</label>
            <input
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <button
            onClick={saveCompany}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          >
            <Save size={16} />
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Crew tab */}
      {activeTab === 'crew' && (
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
              value={crewHalfHours}
              onChange={(e) => setCrewHalfHours(Number(e.target.value))}
              className="w-32 rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p><strong>Full day:</strong> {crewMen} x {crewFullHours} = {crewMen * crewFullHours} MH</p>
            <p><strong>Half day:</strong> {crewMen} x {crewHalfHours} = {crewMen * crewHalfHours} MH</p>
          </div>
          <button
            onClick={saveCompany}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          >
            <Save size={16} />
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* KYN My Numbers tab */}
      {activeTab === 'kyn' && (
        <div className="rounded-xl border border-border bg-white p-6 space-y-5">
          <div className="rounded-lg bg-navy/5 p-4">
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
              <div>
                <p className="text-xl font-bold text-navy">${retailRate.toFixed(2)}/hr</p>
                <p className="text-xs text-muted-foreground">Retail Labor Rate</p>
              </div>
              <div>
                <p className="text-xl font-bold text-navy">{materialMarkup}%</p>
                <p className="text-xs text-muted-foreground">Material Markup</p>
              </div>
              <div>
                <p className="text-xl font-bold text-navy">{subMarkup}%</p>
                <p className="text-xs text-muted-foreground">Sub Markup</p>
              </div>
              <div>
                <p className="text-xl font-bold text-navy">{targetProfit}%</p>
                <p className="text-xs text-muted-foreground">Target Profit</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Base Hourly Wage ($)</label>
              <input type="number" step={0.5} value={baseWage}
                onChange={(e) => setBaseWage(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Payroll Tax Rate (%)</label>
              <input type="number" step={0.5} value={payrollTaxRate}
                onChange={(e) => setPayrollTaxRate(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Workers Comp Rate (%)</label>
              <input type="number" step={0.5} value={workersCompRate}
                onChange={(e) => setWorkersCompRate(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Target Net Profit (%)</label>
              <input type="number" step={1} min={5} max={30} value={targetProfit}
                onChange={(e) => setTargetProfit(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Material Markup (%)</label>
              <input type="number" step={1} value={materialMarkup}
                onChange={(e) => setMaterialMarkup(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Sub Markup (%)</label>
              <input type="number" step={1} value={subMarkup}
                onChange={(e) => setSubMarkup(Number(e.target.value))}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
          </div>

          <button
            onClick={async () => {
              if (!company) return
              setSaving(true)
              await supabase.from('companies').update({
                base_hourly_wage: baseWage,
                payroll_tax_rate: payrollTaxRate,
                workers_comp_rate: workersCompRate,
                target_profit_percent: targetProfit,
                material_markup_percent: materialMarkup,
                sub_markup_percent: subMarkup,
              }).eq('id', company.id)
              await refreshCompany()
              setSaving(false)
              toast.success('My Numbers updated')
            }}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save My Numbers'}
          </button>

          <p className="text-xs text-muted-foreground">
            To recalculate your retail labor rate from scratch, re-run the KYN Setup Wizard from the overhead and profit steps.
          </p>
        </div>
      )}

      {/* Rates tab */}
      {activeTab === 'rates' && (
        <CatalogEditor
          items={rates}
          columns={['Work Type', 'Unit', 'MH/Unit', 'Notes']}
          fields={['work_type', 'unit', 'man_hours_per_unit', 'notes']}
          fieldTypes={['text', 'text', 'number', 'text']}
          onAdd={addRate}
          onRemove={removeRate}
          onUpdate={updateRate}
        />
      )}

      {/* Materials tab */}
      {activeTab === 'materials' && (
        <CatalogEditor
          items={materials}
          columns={['Name', 'Unit', 'Unit Cost', 'Supplier']}
          fields={['name', 'unit', 'unit_cost', 'supplier']}
          fieldTypes={['text', 'text', 'number', 'text']}
          onAdd={addMaterial}
          onRemove={removeMaterial}
          onUpdate={updateMaterial}
        />
      )}

      {/* Subs tab */}
      {activeTab === 'subs' && (
        <CatalogEditor
          items={subs}
          columns={['Name', 'Unit', 'Unit Cost', 'Trade']}
          fields={['name', 'unit', 'unit_cost', 'trade']}
          fieldTypes={['text', 'text', 'number', 'text']}
          onAdd={addSub}
          onRemove={removeSub}
          onUpdate={updateSub}
        />
      )}

      {/* Equipment tab */}
      {activeTab === 'equipment' && (
        <div className="rounded-xl border border-border bg-white p-6">
          <div className="space-y-3">
            {equipment.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <input
                  value={item.name}
                  onChange={(e) => updateEquipment(item.id, 'name', e.target.value)}
                  className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                  placeholder="Equipment name"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.billable}
                    onChange={(e) => updateEquipment(item.id, 'billable', e.target.checked)}
                  />
                  Billable
                </label>
                <ConfirmDelete onConfirm={() => removeEquipment(item.id)} />
              </div>
            ))}
          </div>
          <button onClick={addEquipment} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
            <Plus size={16} /> Add Equipment
          </button>
        </div>
      )}

      {/* Work Types tab */}
      {activeTab === 'work-types' && (
        <div className="rounded-xl border border-border bg-white p-6">
          <div className="space-y-3">
            {workTypes.map((wt) => (
              <div key={wt.id} className="flex items-center gap-3">
                <input
                  value={wt.name}
                  onChange={(e) => updateWorkType(wt.id, 'name', e.target.value)}
                  className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                  placeholder="Work type"
                />
                <select
                  value={wt.category}
                  onChange={(e) => updateWorkType(wt.id, 'category', e.target.value)}
                  className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
                >
                  <option value="hardscape">Hardscape</option>
                  <option value="planting">Planting</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="irrigation">Irrigation</option>
                  <option value="grading">Grading</option>
                  <option value="demolition">Demolition</option>
                  <option value="other">Other</option>
                </select>
                <ConfirmDelete onConfirm={() => removeWorkType(wt.id)} />
              </div>
            ))}
          </div>
          <button onClick={addWorkType} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
            <Plus size={16} /> Add Work Type
          </button>
        </div>
      )}
    </div>
  )
}

// Generic catalog editor
function CatalogEditor<T extends { id: string }>({
  items,
  columns,
  fields,
  fieldTypes,
  onAdd,
  onRemove,
  onUpdate,
}: {
  items: T[]
  columns: string[]
  fields: string[]
  fieldTypes: ('text' | 'number')[]
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: string, value: string | number) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      {items.length > 0 && (
        <div className="mb-3 hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid">
          {columns.map((col) => <div key={col}>{col}</div>)}
          <div className="w-8" />
        </div>
      )}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            {fields.map((field, fi) => (
              <input
                key={field}
                type={fieldTypes[fi]}
                step={fieldTypes[fi] === 'number' ? '0.01' : undefined}
                value={(item as Record<string, unknown>)[field] as string | number ?? ''}
                onChange={(e) =>
                  onUpdate(
                    item.id,
                    field,
                    fieldTypes[fi] === 'number' ? Number(e.target.value) : e.target.value
                  )
                }
                className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
              />
            ))}
            <ConfirmDelete onConfirm={() => onRemove(item.id)} />
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
      >
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
