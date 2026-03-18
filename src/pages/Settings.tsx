import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type {
  ProductionRate,
  DisposalCatalogItem,
  WorkType,
  QCCatalogItem,
} from '@/lib/types'
import {
  Building2,
  Gauge,
  Package,
  Wrench,
  Truck,
  Layers,
  Plus,
  Receipt,
  ExternalLink,
} from 'lucide-react'
import { ConfirmDelete } from '@/components/ConfirmDelete'

type Tab = 'company' | 'rates' | 'materials' | 'subs' | 'equipment' | 'disposal' | 'work-types'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={16} /> },
  { id: 'rates', label: 'Production Rates', icon: <Gauge size={16} /> },
  { id: 'materials', label: 'Materials', icon: <Package size={16} /> },
  { id: 'subs', label: 'Subs', icon: <Wrench size={16} /> },
  { id: 'equipment', label: 'Equipment', icon: <Truck size={16} /> },
  { id: 'disposal', label: 'Disposal', icon: <Receipt size={16} /> },
  { id: 'work-types', label: 'Work Types', icon: <Layers size={16} /> },
]

export function Settings() {
  const { user, companyProfile } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('company')

  // BidClaw-owned catalogs
  const [rates, setRates] = useState<ProductionRate[]>([])
  const [disposal, setDisposal] = useState<DisposalCatalogItem[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])

  // QC catalog items (read-only)
  const [qcMaterials, setQcMaterials] = useState<QCCatalogItem[]>([])
  const [qcSubs, setQcSubs] = useState<QCCatalogItem[]>([])
  const [qcEquipment, setQcEquipment] = useState<QCCatalogItem[]>([])

  useEffect(() => {
    if (!user) return

    const load = async () => {
      const [r, d, w, mats, subs, equip] = await Promise.all([
        supabase.from('bidclaw_production_rates').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_disposal_catalog').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_work_types').select('*').eq('user_id', user.id),
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).eq('type', 'material'),
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).eq('type', 'subcontractor'),
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id).eq('type', 'equipment'),
      ])
      setRates(r.data ?? [])
      setDisposal(d.data ?? [])
      setWorkTypes(w.data ?? [])
      setQcMaterials(mats.data ?? [])
      setQcSubs(subs.data ?? [])
      setQcEquipment(equip.data ?? [])
    }
    load()
  }, [user])

  // ── CRUD helpers for BidClaw-owned tables ──
  const crudFor = <T extends { id: string }>(
    table: string,
    items: T[],
    setItems: (v: T[]) => void,
    defaults: Record<string, unknown>
  ) => ({
    add: async () => {
      if (!user) return
      const { data } = await supabase.from(table).insert({ ...defaults, user_id: user.id }).select('*').single()
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

  const ratesCrud = crudFor('bidclaw_production_rates', rates, setRates, { work_type: '', unit: '', man_hours_per_unit: 0 })
  const disposalCrud = crudFor('bidclaw_disposal_catalog', disposal, setDisposal, { name: '', um: '' })
  const wtCrud = crudFor('bidclaw_work_types', workTypes, setWorkTypes, { name: '', category: 'other' })

  const qcLink = (
    <a
      href="https://bluequickcalc.app"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
    >
      Manage in QuickCalc <ExternalLink size={14} />
    </a>
  )

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

      {/* Company tab — READ-ONLY from QC */}
      {activeTab === 'company' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold" style={{ color: '#1e3a5f' }}>Company Profile</h3>
            <a
              href="https://bluequickcalc.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              Edit in QuickCalc <ExternalLink size={14} />
            </a>
          </div>
          <p className="text-xs text-slate-500">Company information is managed in QuickCalc.</p>
          {companyProfile ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnlyField label="Company Name" value={companyProfile.companyName} />
              <ReadOnlyField label="Contact Name" value={companyProfile.userName} />
              <ReadOnlyField label="Address" value={companyProfile.companyAddress} span2 />
              <ReadOnlyField label="Email" value={companyProfile.companyEmail} />
              <ReadOnlyField label="Phone" value={companyProfile.companyPhone} />
              <ReadOnlyField label="Website" value={companyProfile.companyWebsite} span2 />
            </div>
          ) : (
            <p className="text-sm text-slate-500">No company profile found. Set up your profile in QuickCalc.</p>
          )}
        </div>
      )}

      {/* Production Rates — BidClaw owned */}
      {activeTab === 'rates' && (
        <SettingsCatalog items={rates} columns={['Work Type', 'Unit', 'MH/Unit', 'Notes']}
          fields={['work_type', 'unit', 'man_hours_per_unit', 'notes']} fieldTypes={['text', 'text', 'number', 'text']}
          onAdd={ratesCrud.add} onRemove={ratesCrud.remove} onUpdate={ratesCrud.update} />
      )}

      {/* Materials — READ-ONLY from QC */}
      {activeTab === 'materials' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">Materials are managed in QuickCalc.</p>
            {qcLink}
          </div>
          {qcMaterials.length > 0 ? (
            <div className="space-y-2">
              {qcMaterials.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700">
                  {m.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No materials found. Add them in QuickCalc.</p>
          )}
        </div>
      )}

      {/* Subs — READ-ONLY from QC */}
      {activeTab === 'subs' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">Subcontractors are managed in QuickCalc.</p>
            {qcLink}
          </div>
          {qcSubs.length > 0 ? (
            <div className="space-y-2">
              {qcSubs.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700">
                  {s.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No subcontractors found. Add them in QuickCalc.</p>
          )}
        </div>
      )}

      {/* Equipment — READ-ONLY from QC */}
      {activeTab === 'equipment' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">Equipment is managed in QuickCalc.</p>
            {qcLink}
          </div>
          {qcEquipment.length > 0 ? (
            <div className="space-y-2">
              {qcEquipment.map((e) => (
                <div key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700">
                  {e.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No equipment found. Add it in QuickCalc.</p>
          )}
        </div>
      )}

      {/* Disposal — BidClaw owned */}
      {activeTab === 'disposal' && (
        <SettingsCatalog items={disposal} columns={['Name', 'U/M']}
          fields={['name', 'um']} fieldTypes={['text', 'text']}
          onAdd={disposalCrud.add} onRemove={disposalCrud.remove} onUpdate={disposalCrud.update} />
      )}

      {/* Work Types — BidClaw owned */}
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

// ── Read-only field display ──
function ReadOnlyField({ label, value, span2 }: { label: string; value?: string; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        {value || '—'}
      </p>
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
