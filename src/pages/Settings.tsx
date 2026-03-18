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

type Tab = 'company' | 'rates' | 'materials' | 'subs' | 'equipment' | 'disposal' | 'work-types'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={16} /> },
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
  const [contactName, setContactName] = useState('')
  const [companyStreet, setCompanyStreet] = useState('')
  const [companyCity, setCompanyCity] = useState('')
  const [companyState, setCompanyState] = useState('')
  const [companyZip, setCompanyZip] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

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
    setContactName(company.contact_name ?? '')
    setCompanyStreet(company.street ?? '')
    setCompanyCity(company.city ?? '')
    setCompanyState(company.state ?? '')
    setCompanyZip(company.zip ?? '')
    setCompanyEmail(company.email ?? '')
    setCompanyPhone(company.phone ?? '')
    setCompanyWebsite(company.website ?? '')
    setLogoUrl(company.logo_url)

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
      contact_name: contactName || null,
      street: companyStreet || null,
      city: companyCity || null,
      state: companyState || null,
      zip: companyZip || null,
      email: companyEmail || null,
      phone: companyPhone || null,
      website: companyWebsite || null,
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
  const matsCrud = crudFor('materials_catalog', materials, setMaterials, { name: '', um: '' })
  const subsCrud = crudFor('subs_catalog', subs, setSubs, { name: '', trade: '' })
  const equipCrud = crudFor('equipment_catalog', equipment, setEquipment, { name: '', um: 'HR' })
  const disposalCrud = crudFor('disposal_catalog', disposal, setDisposal, { name: '', um: '' })
  const wtCrud = crudFor('work_types', workTypes, setWorkTypes, { name: '', category: 'other' })

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: '#1e3a5f' }}>Settings</h2>

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id ? 'text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
            }`}
            style={activeTab === t.id ? { background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' } : {}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Company tab */}
      {activeTab === 'company' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Company Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt="Company logo" className="h-16 w-16 rounded-lg border border-slate-200 object-contain bg-slate-50" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400"><Upload size={20} /></div>
              )}
              <div>
                <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <Upload size={14} /> {logoUploading ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
                <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={handleLogoUpload} className="hidden" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Company Name</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Contact Name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Street Address</label>
            <input value={companyStreet} onChange={(e) => setCompanyStreet(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
              <input value={companyCity} onChange={(e) => setCompanyCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
              <input value={companyState} onChange={(e) => setCompanyState(e.target.value)} maxLength={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Zip</label>
              <input value={companyZip} onChange={(e) => setCompanyZip(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
              <input type="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Website</label>
            <input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <button onClick={saveCompany} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
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

      {/* Materials — NAME | U/M | SUPPLIER */}
      {activeTab === 'materials' && (
        <SettingsCatalog items={materials} columns={['Name', 'U/M', 'Supplier']}
          fields={['name', 'um', 'supplier']} fieldTypes={['text', 'text', 'text']}
          onAdd={matsCrud.add} onRemove={matsCrud.remove} onUpdate={matsCrud.update} />
      )}

      {/* Subs — NAME | TRADE */}
      {activeTab === 'subs' && (
        <SettingsCatalog items={subs} columns={['Name', 'Trade']}
          fields={['name', 'trade']} fieldTypes={['text', 'text']}
          onAdd={subsCrud.add} onRemove={subsCrud.remove} onUpdate={subsCrud.update} />
      )}

      {/* Equipment — EQUIPMENT | U/M */}
      {activeTab === 'equipment' && (
        <SettingsCatalog items={equipment} columns={['Equipment', 'U/M']}
          fields={['name', 'um']} fieldTypes={['text', 'text']}
          onAdd={equipCrud.add} onRemove={equipCrud.remove} onUpdate={equipCrud.update} />
      )}

      {/* Disposal — NAME | U/M */}
      {activeTab === 'disposal' && (
        <SettingsCatalog items={disposal} columns={['Name', 'U/M']}
          fields={['name', 'um']} fieldTypes={['text', 'text']}
          onAdd={disposalCrud.add} onRemove={disposalCrud.remove} onUpdate={disposalCrud.update} />
      )}

      {/* Work Types */}
      {activeTab === 'work-types' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="space-y-3">
            {workTypes.map((wt) => (
              <div key={wt.id} className="flex items-center gap-3">
                <input value={wt.name} onChange={(e) => wtCrud.update(wt.id, 'name', e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Work type" />
                <select value={wt.category} onChange={(e) => wtCrud.update(wt.id, 'category', e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="hardscape">Hardscape</option><option value="planting">Planting</option>
                  <option value="maintenance">Maintenance</option><option value="irrigation">Irrigation</option>
                  <option value="grading">Grading</option><option value="demolition">Demolition</option>
                  <option value="other">Other</option>
                </select>
                <ConfirmDelete onConfirm={() => wtCrud.remove(wt.id)} />
              </div>
            ))}
          </div>
          <button onClick={wtCrud.add} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800">
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
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      {items.length > 0 && (
        <div className="mb-3 hidden gap-2 text-xs font-medium uppercase text-slate-500 sm:grid"
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
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            ))}
            <ConfirmDelete onConfirm={() => onRemove(item.id)} />
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800">
        <Plus size={16} /> Add Row
      </button>
    </div>
  )
}
