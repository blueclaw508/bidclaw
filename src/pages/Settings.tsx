import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  ProductionRate,
  MaterialCatalogItem,
  SubCatalogItem,
  EquipmentItem,
  DisposalCatalogItem,
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
  Receipt,
} from 'lucide-react'
import { ConfirmDelete } from '@/components/ConfirmDelete'

type Tab = 'company' | 'crew' | 'rates' | 'materials' | 'subs' | 'equipment' | 'disposal' | 'work-types'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={16} /> },
  { id: 'crew', label: 'Crew', icon: <Users size={16} /> },
  { id: 'rates', label: 'Production Rates', icon: <Gauge size={16} /> },
  { id: 'materials', label: 'Item Catalog — Materials', icon: <Package size={16} /> },
  { id: 'subs', label: 'Item Catalog — Subs', icon: <Wrench size={16} /> },
  { id: 'equipment', label: 'Item Catalog — Equipment', icon: <Truck size={16} /> },
  { id: 'disposal', label: 'Item Catalog — Disposal', icon: <Receipt size={16} /> },
  { id: 'work-types', label: 'Work Types', icon: <Layers size={16} /> },
]

export function Settings() {
  const { company, refreshCompany } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('company')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Company
  const [companyName, setCompanyName] = useState('')
  const [companyStreet, setCompanyStreet] = useState('')
  const [companyCity, setCompanyCity] = useState('')
  const [companyState, setCompanyState] = useState('')
  const [companyZip, setCompanyZip] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Crew
  const [crewSize, setCrewSize] = useState(3)
  const [crewFullHours, setCrewFullHours] = useState(9)
  const [crewHalfHours, setCrewHalfHours] = useState(4.5)

  // Catalogs
  const [rates, setRates] = useState<ProductionRate[]>([])
  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([])
  const [subs, setSubs] = useState<SubCatalogItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [disposal, setDisposal] = useState<DisposalCatalogItem[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])

  useEffect(() => {
    if (!company) return
    setCompanyName(company.name)
    setCompanyStreet(company.street ?? '')
    setCompanyCity(company.city ?? '')
    setCompanyState(company.state ?? '')
    setCompanyZip(company.zip ?? '')
    setLogoUrl(company.logo_url)
    setCrewSize(company.typical_crew_size)
    setCrewFullHours(company.crew_full_day_hours)
    setCrewHalfHours(company.crew_half_day_hours)

    const load = async () => {
      const [r, m, s, e, d, w] = await Promise.all([
        supabase.from('production_rates').select('*').eq('company_id', company.id),
        supabase.from('materials_catalog').select('*').eq('company_id', company.id),
        supabase.from('subs_catalog').select('*').eq('company_id', company.id),
        supabase.from('equipment_catalog').select('*').eq('company_id', company.id),
        supabase.from('disposal_catalog').select('*').eq('company_id', company.id),
        supabase.from('work_types').select('*').eq('company_id', company.id),
      ])
      setRates(r.data ?? [])
      setMaterials(m.data ?? [])
      setSubs(s.data ?? [])
      setEquipment(e.data ?? [])
      setDisposal(d.data ?? [])
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
      const { error: uploadErr } = await supabase.storage.from('logos').upload(path, file)
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
      street: companyStreet || null,
      city: companyCity || null,
      state: companyState || null,
      zip: companyZip || null,
      typical_crew_size: crewSize,
      crew_full_day_hours: crewFullHours,
      crew_half_day_hours: crewHalfHours,
    }).eq('id', company.id)
    await refreshCompany()
    setSaving(false)
    setSaved(true)
    toast.success('Settings saved')
    setTimeout(() => setSaved(false), 2000)
  }

  // ── CRUD helpers ──
  const crudFor = <T extends { id: string }>(
    table: string,
    items: T[],
    setItems: (v: T[]) => void,
    defaults: Record<string, unknown>
  ) => ({
    add: async () => {
      if (!company) return
      const { data } = await supabase.from(table).insert({ ...defaults, company_id: company.id }).select('*').single()
      if (data) setItems([...items, data as T])
    },
    remove: async (id: string) => {
      await supabase.from(table).delete().eq('id', id)
      setItems(items.filter((i) => i.id !== id))
    },
    update: async (id: string, field: string, value: string | number | boolean) => {
      await supabase.from(table).update({ [field]: value }).eq('id', id)
      setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
    },
  })

  const ratesCrud = crudFor('production_rates', rates, setRates, { work_type: '', unit: '', man_hours_per_unit: 0 })
  const matsCrud = crudFor('materials_catalog', materials, setMaterials, { name: '', um: '', unit: '', unit_cost: 0 })
  const subsCrud = crudFor('subs_catalog', subs, setSubs, { name: '', um: '', unit: '', unit_cost: 0 })
  const equipCrud = crudFor('equipment_catalog', equipment, setEquipment, { name: '', billable: true })
  const disposalCrud = crudFor('disposal_catalog', disposal, setDisposal, { name: '', um: '', unit: '', unit_cost: 0 })
  const wtCrud = crudFor('work_types', workTypes, setWorkTypes, { name: '', category: 'other' })

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="mb-6 text-2xl font-bold text-navy">Settings</h2>

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id ? 'bg-navy text-white' : 'bg-white text-muted-foreground hover:bg-muted'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Company tab */}
      {activeTab === 'company' && (
        <div className="rounded-xl border border-border bg-white p-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Company Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt="Company logo" className="h-16 w-16 rounded-lg border border-border object-contain bg-muted/30" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 text-muted-foreground"><Upload size={20} /></div>
              )}
              <div>
                <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
                  <Upload size={14} /> {logoUploading ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
                <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={handleLogoUpload} className="hidden" />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Company Name</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Street Address</label>
            <input value={companyStreet} onChange={(e) => setCompanyStreet(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">City</label>
              <input value={companyCity} onChange={(e) => setCompanyCity(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">State</label>
              <input value={companyState} onChange={(e) => setCompanyState(e.target.value)} maxLength={2}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Zip</label>
              <input value={companyZip} onChange={(e) => setCompanyZip(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" />
            </div>
          </div>
          <button onClick={saveCompany} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50">
            <Save size={16} /> {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Crew tab */}
      {activeTab === 'crew' && (
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
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p><strong>Full day:</strong> {crewSize} × {crewFullHours} = {crewSize * crewFullHours} MH</p>
            <p><strong>Half day:</strong> {crewSize} × {crewHalfHours} = {crewSize * crewHalfHours} MH</p>
          </div>
          <button onClick={saveCompany} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50">
            <Save size={16} /> {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Production Rates */}
      {activeTab === 'rates' && (
        <SettingsCatalog items={rates} columns={['Work Type', 'Unit', 'MH/Unit', 'Notes']}
          fields={['work_type', 'unit', 'man_hours_per_unit', 'notes']} fieldTypes={['text', 'text', 'number', 'text']}
          onAdd={ratesCrud.add} onRemove={ratesCrud.remove} onUpdate={ratesCrud.update} />
      )}

      {/* Materials */}
      {activeTab === 'materials' && (
        <SettingsCatalog items={materials} columns={['Name', 'U/M', 'Unit', 'Unit Cost', 'Supplier']}
          fields={['name', 'um', 'unit', 'unit_cost', 'supplier']} fieldTypes={['text', 'text', 'text', 'number', 'text']}
          onAdd={matsCrud.add} onRemove={matsCrud.remove} onUpdate={matsCrud.update} />
      )}

      {/* Subs */}
      {activeTab === 'subs' && (
        <SettingsCatalog items={subs} columns={['Name', 'U/M', 'Unit', 'Unit Cost', 'Trade']}
          fields={['name', 'um', 'unit', 'unit_cost', 'trade']} fieldTypes={['text', 'text', 'text', 'number', 'text']}
          onAdd={subsCrud.add} onRemove={subsCrud.remove} onUpdate={subsCrud.update} />
      )}

      {/* Equipment */}
      {activeTab === 'equipment' && (
        <div className="rounded-xl border border-border bg-white p-6">
          <div className="space-y-3">
            {equipment.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <input value={item.name} onChange={(e) => equipCrud.update(item.id, 'name', e.target.value)}
                  className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Equipment name" />
                <ConfirmDelete onConfirm={() => equipCrud.remove(item.id)} />
              </div>
            ))}
          </div>
          <button onClick={equipCrud.add} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
            <Plus size={16} /> Add Equipment
          </button>
        </div>
      )}

      {/* Disposal */}
      {activeTab === 'disposal' && (
        <SettingsCatalog items={disposal} columns={['Name', 'U/M', 'Unit', 'Unit Cost']}
          fields={['name', 'um', 'unit', 'unit_cost']} fieldTypes={['text', 'text', 'text', 'number']}
          onAdd={disposalCrud.add} onRemove={disposalCrud.remove} onUpdate={disposalCrud.update} />
      )}

      {/* Work Types */}
      {activeTab === 'work-types' && (
        <div className="rounded-xl border border-border bg-white p-6">
          <div className="space-y-3">
            {workTypes.map((wt) => (
              <div key={wt.id} className="flex items-center gap-3">
                <input value={wt.name} onChange={(e) => wtCrud.update(wt.id, 'name', e.target.value)}
                  className="flex-1 rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" placeholder="Work type" />
                <select value={wt.category} onChange={(e) => wtCrud.update(wt.id, 'category', e.target.value)}
                  className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold">
                  <option value="hardscape">Hardscape</option><option value="planting">Planting</option>
                  <option value="maintenance">Maintenance</option><option value="irrigation">Irrigation</option>
                  <option value="grading">Grading</option><option value="demolition">Demolition</option>
                  <option value="other">Other</option>
                </select>
                <ConfirmDelete onConfirm={() => wtCrud.remove(wt.id)} />
              </div>
            ))}
          </div>
          <button onClick={wtCrud.add} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
            <Plus size={16} /> Add Work Type
          </button>
        </div>
      )}
    </div>
  )
}

// ── Generic settings catalog editor ──
function SettingsCatalog<T extends { id: string }>({ items, columns, fields, fieldTypes, onAdd, onRemove, onUpdate }: {
  items: T[]; columns: string[]; fields: string[]; fieldTypes: ('text' | 'number')[]
  onAdd: () => void; onRemove: (id: string) => void
  onUpdate: (id: string, field: string, value: string | number) => void
}) {
  const colTemplate = fields.map(() => '1fr').join(' ') + ' auto'
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      {items.length > 0 && (
        <div className="mb-3 hidden gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid"
          style={{ gridTemplateColumns: colTemplate }}>
          {columns.map((col) => <div key={col}>{col}</div>)}
          <div className="w-8" />
        </div>
      )}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2" style={{ gridTemplateColumns: colTemplate }}>
            {fields.map((field, fi) => (
              <input key={field} type={fieldTypes[fi]} step={fieldTypes[fi] === 'number' ? '0.01' : undefined}
                value={(item as Record<string, unknown>)[field] as string | number ?? ''}
                onChange={(e) => onUpdate(item.id, field, fieldTypes[fi] === 'number' ? Number(e.target.value) : e.target.value)}
                className="rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold" />
            ))}
            <ConfirmDelete onConfirm={() => onRemove(item.id)} />
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark">
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
