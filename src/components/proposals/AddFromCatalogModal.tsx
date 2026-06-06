import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { supabase } from '@/lib/supabase'
import { addCustomLine } from '@/lib/proposals'
import type { CatalogCategory, CatalogItem, ProposalLineCategory } from '@/lib/types'

/**
 * Modal for adding a material / subcontractor / other line into an
 * existing proposal_work_area by picking from the contractor's
 * catalog. Filtered to the subsection's category.
 *
 * Flow:
 *   1. Load catalog items filtered by category (active=true only)
 *   2. Contractor searches + picks one row
 *   3. Inline quantity prompt (DecimalInput) appears for the picked row
 *   4. Submit → addCustomLine with the catalog item's data + qty
 *
 * Labor + Equipment subsections use AddCustomLineModal instead since
 * their lines reference labor_types / equipment_rates from settings,
 * not the catalog.
 */

interface AddFromCatalogModalProps {
  open: boolean
  onClose: () => void
  proposalWorkAreaId: string
  /** Subsection category — used to filter the catalog list. */
  category: Exclude<ProposalLineCategory, 'labor' | 'equipment'>
  onAdded: () => void
}

export function AddFromCatalogModal({
  open,
  onClose,
  proposalWorkAreaId,
  category,
  onAdded,
}: AddFromCatalogModalProps) {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const [qty, setQty] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelected(null)
    setQty(null)
    setSubmitting(false)
  }, [open])

  /* ---------- load filtered catalog items ---------- */

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setItems(null)
    setLoadError(null)

    // Catalog filter — proposal_lines.category → catalog_items.category
    // map. Material is strict (just 'material'); subcontractor + other
    // use a broader bucket because catalog doesn't have a dedicated
    // 'subcontractor' category — disposal / design / other cover the
    // typical sub-purchase semantics.
    const catalogFilter: CatalogCategory[] =
      category === 'material'
        ? ['material']
        : category === 'subcontractor'
          ? ['disposal', 'design', 'other']
          : ['other', 'disposal', 'design']

    supabase
      .from('catalog_items')
      .select('*')
      .eq('active', true)
      .in('category', catalogFilter)
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError(error.message)
          setItems([])
          return
        }
        setItems((data ?? []) as CatalogItem[])
      })
    return () => {
      cancelled = true
    }
  }, [open, category])

  /* ---------- filter by search ---------- */

  const filtered = useMemo(() => {
    if (!items) return null
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, search])

  /* ---------- submit ---------- */

  const canSubmit =
    !!selected && qty !== null && Number.isFinite(qty) && qty > 0 && !submitting

  const handleSubmit = async () => {
    if (!selected || !canSubmit) return
    setSubmitting(true)
    try {
      await addCustomLine({
        proposalWorkAreaId,
        category,
        label: selected.name,
        unit: selected.unit,
        quantity: qty as number,
        unitCost: Number(selected.unit_cost),
        catalogItemId: selected.id,
      })
      toast.success('Line added.')
      onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add line.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Add line from catalog"
      description={`Adding a ${LABELS[category]} line to this work area.`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Search */}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder={`Search ${LABELS[category]} items…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
          />
        </label>

        {/* List */}
        {loadError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Couldn't load catalog: {loadError}
          </div>
        )}

        {!loadError && filtered === null && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading catalog…
          </div>
        )}

        {!loadError && filtered !== null && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            {items && items.length === 0 ? (
              <>
                No catalog items match this category.{' '}
                <a
                  href="/app/catalog"
                  className="font-semibold text-brand-navy hover:underline"
                >
                  Add some via Catalog page
                </a>{' '}
                first.
              </>
            ) : (
              <>No catalog items match "{search}".</>
            )}
          </div>
        )}

        {!loadError && filtered !== null && filtered.length > 0 && (
          <ul className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            {filtered.map((item) => {
              const isSelected = selected?.id === item.id
              return (
                <li
                  key={item.id}
                  className={`border-b border-gray-100 last:border-0 ${
                    isSelected ? 'bg-brand-navy/5' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    disabled={submitting}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:opacity-50"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-brand-navy text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {item.name}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        ${Number(item.unit_cost).toFixed(2)} / {item.unit}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Quantity prompt — appears once a row is selected */}
        {selected && (
          <div className="rounded-xl border border-brand-navy/30 bg-brand-navy/5 p-4">
            <div className="mb-3 text-sm">
              <div className="font-semibold text-gray-900">{selected.name}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                ${Number(selected.unit_cost).toFixed(2)} per {selected.unit}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Quantity ({selected.unit}) <span className="ml-1 text-rose-600">*</span>
              </span>
              <DecimalInput
                value={qty}
                onCommit={(n) => setQty(n)}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                disabled={submitting}
              />
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Adding…' : 'Add line'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const LABELS: Record<Exclude<ProposalLineCategory, 'labor' | 'equipment'>, string> = {
  material: 'material',
  subcontractor: 'subcontractor',
  other: 'other',
}
