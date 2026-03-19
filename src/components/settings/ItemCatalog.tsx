import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Search,
  Filter,
  Upload,
  Download,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Package,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { CatalogItem, CatalogCategory, CatalogSource } from '@/lib/types'

const CATEGORIES: CatalogCategory[] = ['Materials', 'Subcontractors', 'Equipment', 'Disposal', 'Labor']

const CATEGORY_COLORS: Record<CatalogCategory, string> = {
  Materials: 'bg-emerald-100 text-emerald-700',
  Subcontractors: 'bg-purple-100 text-purple-700',
  Equipment: 'bg-orange-100 text-orange-700',
  Disposal: 'bg-rose-100 text-rose-700',
  Labor: 'bg-sky-100 text-sky-700',
}

const SOURCE_BADGE: Record<CatalogSource, { label: string; className: string }> = {
  manual: { label: 'Manual', className: 'bg-slate-100 text-slate-600' },
  bidclaw_auto: { label: 'BidClaw Auto', className: 'bg-blue-100 text-[#2563EB]' },
}

interface FormState {
  name: string
  type: CatalogCategory
  unit_cost: string
  default_amount: string
}

const EMPTY_FORM: FormState = { name: '', type: 'Materials', unit_cost: '', default_amount: '' }

export default function ItemCatalog() {
  const { user } = useAuth()
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CatalogCategory | 'All'>('All')
  const [showNeedsPricing, setShowNeedsPricing] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('kyn_catalog_items')
      .select('*')
      .eq('user_id', user.id)
      .order('name')
    setItems((data as CatalogItem[]) ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const filtered = items.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    if (categoryFilter !== 'All' && item.type !== categoryFilter) return false
    if (showNeedsPricing && !item.needs_pricing) return false
    return true
  })

  // ── Modal helpers ──

  function openAdd() {
    setEditingItem(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(item: CatalogItem) {
    setEditingItem(item)
    setForm({
      name: item.name,
      type: item.type as CatalogCategory,
      unit_cost: item.unit_cost != null ? String(item.unit_cost) : '',
      default_amount: item.default_amount != null ? String(item.default_amount) : '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!user || !form.name.trim()) return
    setSaving(true)

    const payload = {
      user_id: user.id,
      name: form.name.trim(),
      type: form.type,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      default_amount: form.default_amount ? parseFloat(form.default_amount) : null,
      needs_pricing: !form.unit_cost,
      source: 'manual' as CatalogSource,
      updated_at: new Date().toISOString(),
    }

    if (editingItem) {
      await supabase.from('kyn_catalog_items').update(payload).eq('id', editingItem.id)
    } else {
      await supabase.from('kyn_catalog_items').insert({ ...payload, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setModalOpen(false)
    fetchItems()
  }

  async function handleDelete(id: string) {
    await supabase.from('kyn_catalog_items').delete().eq('id', id)
    setDeletingId(null)
    fetchItems()
  }

  // ── CSV placeholders ──

  function handleImportCSV() {
    alert('CSV Import coming soon.')
  }

  function handleExportCSV() {
    alert('CSV Export coming soon.')
  }

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* Category Filter */}
        <div className="relative">
          <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CatalogCategory | 'All')}
            className="appearance-none rounded-md border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Needs Pricing Toggle */}
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          <input
            type="checkbox"
            checked={showNeedsPricing}
            onChange={(e) => setShowNeedsPricing(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB] accent-[#2563EB]"
          />
          <AlertTriangle size={14} className="text-amber-500" />
          Needs Pricing
        </label>

        {/* Import / Export */}
        <button
          onClick={handleImportCSV}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Upload size={14} /> Import
        </button>
        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Download size={14} /> Export
        </button>

        {/* Add Item */}
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] transition-colors"
        >
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Items Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading catalog...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white py-12 text-center">
          <Package size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">
            {items.length === 0 ? 'No catalog items yet. Add your first item above.' : 'No items match your filters.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Unit Cost</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-700">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[item.type as CatalogCategory] ?? 'bg-slate-100 text-slate-600'}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {item.unit_cost != null ? `$${item.unit_cost.toFixed(2)}` : '--'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_BADGE[item.source]?.className ?? 'bg-slate-100 text-slate-500'}`}>
                      {SOURCE_BADGE[item.source]?.label ?? item.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.needs_pricing && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                        <AlertTriangle size={10} />
                        No price set &mdash; add pricing in QuickCalc
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(item)}
                        className="text-slate-400 hover:text-[#2563EB]"
                        aria-label="Edit item"
                      >
                        <Pencil size={14} />
                      </button>
                      {deletingId === item.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-600 text-white hover:bg-red-700"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(item.id)}
                          className="text-slate-400 hover:text-red-600"
                          aria-label="Delete item"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        {filtered.length} item{filtered.length !== 1 ? 's' : ''} shown
        {items.length !== filtered.length && ` of ${items.length} total`}
      </p>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">
                {editingItem ? 'Edit Item' : 'Add Catalog Item'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Item Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="e.g. Bahia Sod"
                  autoFocus
                />
              </div>

              {/* Category */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CatalogCategory }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Unit Cost */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Unit Cost <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.unit_cost}
                  onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="0.00"
                />
              </div>

              {/* Default Amount */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Default Amount <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.default_amount}
                  onChange={(e) => setForm((f) => ({ ...f, default_amount: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="1"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
