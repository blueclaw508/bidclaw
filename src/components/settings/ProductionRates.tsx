import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Pencil, Check, Trash2, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { ProductionRate } from '@/lib/types'
import { PRODUCTION_RATE_DEFAULTS } from '@/lib/types'

interface FormState {
  task_name: string
  unit: string
  crew_size: string
  hours_per_unit: string
  notes: string
}

const EMPTY_FORM: FormState = {
  task_name: '',
  unit: '',
  crew_size: '2',
  hours_per_unit: '',
  notes: '',
}

export default function ProductionRates() {
  const { user } = useAuth()
  const [rates, setRates] = useState<ProductionRate[]>([])
  const [loading, setLoading] = useState(true)

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchRates = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('production_rates')
      .select('*')
      .eq('user_id', user.id)
      .order('task_name')
    setRates((data as ProductionRate[]) ?? [])
    setLoading(false)
  }, [user])

  // Pre-populate defaults for new users
  const seedDefaults = useCallback(async () => {
    if (!user) return
    const { count } = await supabase
      .from('production_rates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count === 0) {
      const now = new Date().toISOString()
      const rows = PRODUCTION_RATE_DEFAULTS.map((d) => ({
        user_id: user.id,
        ...d,
        created_at: now,
        updated_at: now,
      }))
      await supabase.from('production_rates').insert(rows)
    }
  }, [user])

  useEffect(() => {
    seedDefaults().then(fetchRates)
  }, [seedDefaults, fetchRates])

  // ── Add via modal ──

  async function handleAdd() {
    if (!user || !form.task_name.trim() || !form.unit.trim()) return
    setSaving(true)
    const now = new Date().toISOString()
    await supabase.from('production_rates').insert({
      user_id: user.id,
      task_name: form.task_name.trim(),
      unit: form.unit.trim(),
      crew_size: parseInt(form.crew_size) || 2,
      hours_per_unit: parseFloat(form.hours_per_unit) || 0,
      notes: form.notes.trim() || null,
      created_at: now,
      updated_at: now,
    })
    setSaving(false)
    setModalOpen(false)
    setForm(EMPTY_FORM)
    fetchRates()
  }

  // ── Inline edit ──

  function startEdit(rate: ProductionRate) {
    setEditingId(rate.id)
    setEditForm({
      task_name: rate.task_name,
      unit: rate.unit,
      crew_size: String(rate.crew_size),
      hours_per_unit: String(rate.hours_per_unit),
      notes: rate.notes ?? '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    await supabase.from('production_rates').update({
      task_name: editForm.task_name.trim(),
      unit: editForm.unit.trim(),
      crew_size: parseInt(editForm.crew_size) || 2,
      hours_per_unit: parseFloat(editForm.hours_per_unit) || 0,
      notes: editForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editingId)
    setEditingId(null)
    fetchRates()
  }

  async function handleDelete(id: string) {
    await supabase.from('production_rates').delete().eq('id', id)
    setDeletingId(null)
    fetchRates()
  }

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Production rates help BidClaw estimate labor hours more accurately.
        </p>
        <button
          onClick={() => { setForm(EMPTY_FORM); setModalOpen(true) }}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] transition-colors"
        >
          <Plus size={16} /> Add New Rate
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading rates...</div>
      ) : rates.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white py-12 text-center">
          <Clock size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">No production rates yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Task Name</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Crew Size</th>
                <th className="px-4 py-3 text-right">Hours / Unit</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rates.map((rate) =>
                editingId === rate.id ? (
                  <tr key={rate.id} className="bg-blue-50/40">
                    <td className="px-4 py-2">
                      <input
                        value={editForm.task_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, task_name: e.target.value }))}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editForm.unit}
                        onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        min="1"
                        value={editForm.crew_size}
                        onChange={(e) => setEditForm((f) => ({ ...f, crew_size: e.target.value }))}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={editForm.hours_per_unit}
                        onChange={(e) => setEditForm((f) => ({ ...f, hours_per_unit: e.target.value }))}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editForm.notes}
                        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-[#2563EB] focus:outline-none"
                        placeholder="Optional notes"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={saveEdit} className="text-[#2563EB] hover:text-[#1d4ed8]" aria-label="Save">
                          <Check size={16} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600" aria-label="Cancel">
                          <X size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={rate.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-700">{rate.task_name}</td>
                    <td className="px-4 py-3 text-slate-600">{rate.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{rate.crew_size}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{rate.hours_per_unit}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{rate.notes ?? '--'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => startEdit(rate)}
                          className="text-slate-400 hover:text-[#2563EB]"
                          aria-label="Edit rate"
                        >
                          <Pencil size={14} />
                        </button>
                        {deletingId === rate.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(rate.id)}
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
                            onClick={() => setDeletingId(rate.id)}
                            className="text-slate-400 hover:text-red-600"
                            aria-label="Delete rate"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">{rates.length} production rate{rates.length !== 1 ? 's' : ''}</p>

      {/* Add Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Add Production Rate</h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Task Name</label>
                <input
                  type="text"
                  value={form.task_name}
                  onChange={(e) => setForm((f) => ({ ...f, task_name: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="e.g. Sod Installation"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Unit</label>
                  <input
                    type="text"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                    placeholder="SF, LF, CY..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Crew Size</label>
                  <input
                    type="number"
                    min="1"
                    value={form.crew_size}
                    onChange={(e) => setForm((f) => ({ ...f, crew_size: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Hours per Unit</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.hours_per_unit}
                  onChange={(e) => setForm((f) => ({ ...f, hours_per_unit: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="0.02"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Notes <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  placeholder="Optional notes"
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
                onClick={handleAdd}
                disabled={saving || !form.task_name.trim() || !form.unit.trim()}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Add Rate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
