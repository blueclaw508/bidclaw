import { useEffect, useMemo, useState } from 'react'
import { HardHat, Package, Plus, Search, Users, Wrench, FileText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  loadCompanyLaborTypes,
  loadCompanyEquipmentRates,
} from '@/lib/companySettings'
import { formatUSD } from '@/lib/money'
import type {
  CatalogCategory,
  CatalogItem,
  CompanyEquipmentRate,
  CompanyLaborType,
  ProposalLineCategory,
} from '@/lib/types'

/**
 * THE "+ Add Line Item" modal (estimate-first rework, R2). QC model:
 * ONE modal showing the full pickable universe, grouped by line
 * category. Tap an item → it's added to the work area immediately
 * (modal stays open for burst-adds; Done closes). Each group also
 * offers "+ Custom" for the thin-catalog reality of early dogfooding —
 * a custom add creates an empty line of that category which is then
 * edited inline on the row.
 *
 * Sources per group:
 *   Labor         → company_labor_types (named slots; rate = unit_cost)
 *   Materials     → catalog_items category 'material'
 *   Equipment     → company_equipment_rates (named slots)
 *   Subcontractor → catalog_items 'disposal' + 'design' (sub-purchase
 *                   semantics — same mapping the proposal flow used)
 *   Other         → catalog_items 'other'
 *
 * Catalog labor/equipment items also exist (CatalogCategory includes
 * both); they list under their group alongside the settings slots.
 *
 * Kit bulk-add lands in R3 (ports AddFromKitModal's preview commit to
 * work_area_lines).
 */

export interface AddLinePayload {
  category: ProposalLineCategory
  label: string
  unit: string
  quantity: number
  unitCost: number
  catalogItemId?: string | null
}

interface AddLineItemModalProps {
  open: boolean
  onClose: () => void
  workAreaName: string
  /** Adds the line (parent owns optimistic state + DB write). */
  onAdd: (payload: AddLinePayload) => Promise<void>
}

type Group = {
  category: ProposalLineCategory
  label: string
  icon: React.ReactNode
  tint: string
}

const GROUPS: Group[] = [
  { category: 'labor', label: 'Labor', icon: <Users className="h-4 w-4" />, tint: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  { category: 'material', label: 'Materials', icon: <Package className="h-4 w-4" />, tint: 'text-sky-700 bg-sky-50 border-sky-200' },
  { category: 'equipment', label: 'Equipment', icon: <Wrench className="h-4 w-4" />, tint: 'text-amber-700 bg-amber-50 border-amber-200' },
  { category: 'subcontractor', label: 'Subcontractor', icon: <HardHat className="h-4 w-4" />, tint: 'text-orange-700 bg-orange-50 border-orange-200' },
  { category: 'other', label: 'Other', icon: <FileText className="h-4 w-4" />, tint: 'text-slate-700 bg-slate-100 border-slate-200' },
]

/** A pickable entry, normalized across the three sources. */
interface PickEntry {
  key: string
  category: ProposalLineCategory
  label: string
  unit: string
  unitCost: number
  catalogItemId: string | null
}

export function AddLineItemModal({
  open,
  onClose,
  workAreaName,
  onAdd,
}: AddLineItemModalProps) {
  const { user } = useAuth()
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)
  const [laborTypes, setLaborTypes] = useState<CompanyLaborType[]>([])
  const [equipmentRates, setEquipmentRates] = useState<CompanyEquipmentRate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  /** Keys flashing the "added ✓" state (burst-add feedback). */
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set())
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // Inline custom-item form (QC parity: on-the-fly items are SAVED to
  // the Item Catalog, then added to the estimate). One form open at a
  // time, per category group.
  const [customFormCat, setCustomFormCat] = useState<ProposalLineCategory | null>(null)
  const [customName, setCustomName] = useState('')
  const [customUnit, setCustomUnit] = useState('')
  const [customCost, setCustomCost] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setJustAdded(new Set())
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: items, error }, lts, eqs] = await Promise.all([
          supabase
            .from('catalog_items')
            .select('*')
            .eq('active', true)
            .order('name', { ascending: true }),
          loadCompanyLaborTypes(),
          loadCompanyEquipmentRates(),
        ])
        if (cancelled) return
        if (error) throw new Error(error.message)
        setCatalog((items ?? []) as CatalogItem[])
        setLaborTypes(lts.filter((l) => l.name?.trim() && l.rate_per_hour !== null))
        setEquipmentRates(eqs.filter((e) => e.name?.trim() && e.rate_per_hour !== null))
        setLoadError(null)
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Load failed.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  /* ---------- normalize the pickable universe ---------- */

  const entries = useMemo<PickEntry[]>(() => {
    const out: PickEntry[] = []
    for (const lt of laborTypes) {
      out.push({
        key: `lt-${lt.id}`,
        category: 'labor',
        label: lt.name!.trim(),
        unit: 'Hr',
        unitCost: Number(lt.rate_per_hour),
        catalogItemId: null,
      })
    }
    for (const eq of equipmentRates) {
      out.push({
        key: `eq-${eq.id}`,
        category: 'equipment',
        label: eq.name!.trim(),
        unit: 'Hr',
        unitCost: Number(eq.rate_per_hour),
        catalogItemId: null,
      })
    }
    for (const item of catalog ?? []) {
      // catalog category → line category. disposal/design read as
      // sub-purchases (same mapping the proposal flow used); labor +
      // equipment catalog items list alongside the settings slots.
      const category: ProposalLineCategory =
        item.category === 'material'
          ? 'material'
          : item.category === 'labor'
            ? 'labor'
            : item.category === 'equipment'
              ? 'equipment'
              : item.category === 'other'
                ? 'other'
                : 'subcontractor' // disposal + design
      out.push({
        key: `cat-${item.id}`,
        category,
        label: item.name,
        unit: item.unit,
        unitCost: Number(item.unit_cost),
        catalogItemId: item.id,
      })
    }
    return out
  }, [catalog, laborTypes, equipmentRates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.label.toLowerCase().includes(q))
  }, [entries, search])

  /* ---------- add handlers ---------- */

  const handlePick = async (entry: PickEntry) => {
    if (busyKey) return
    setBusyKey(entry.key)
    try {
      await onAdd({
        category: entry.category,
        label: entry.label,
        unit: entry.unit,
        quantity: 1,
        unitCost: entry.unitCost,
        catalogItemId: entry.catalogItemId,
      })
      setJustAdded((prev) => new Set(prev).add(entry.key))
      window.setTimeout(() => {
        setJustAdded((prev) => {
          const next = new Set(prev)
          next.delete(entry.key)
          return next
        })
      }, 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add line.')
    } finally {
      setBusyKey(null)
    }
  }

  /** Open the inline custom form for a category (closes any other). */
  const openCustomForm = (category: ProposalLineCategory) => {
    setCustomFormCat(category)
    setCustomName('')
    setCustomUnit(category === 'labor' || category === 'equipment' ? 'Hr' : 'EA')
    setCustomCost(null)
  }

  /** Line category → catalog category is 1:1 since migration 0014. */
  const toCatalogCategory = (cat: ProposalLineCategory): CatalogCategory => cat

  /**
   * QC parity: the custom item is SAVED to the Item Catalog first, then
   * added to this estimate referencing the new catalog row. Next time
   * it's in the pick list for every estimate.
   */
  const handleCustomSubmit = async () => {
    if (!customFormCat || !user) return
    const name = customName.trim()
    if (!name) {
      toast.error('Give the item a name.')
      return
    }
    const cost = customCost ?? 0
    setBusyKey(`custom-${customFormCat}`)
    try {
      const { data: item, error } = await supabase
        .from('catalog_items')
        .insert({
          user_id: user.id,
          name,
          unit: customUnit.trim() || 'EA',
          category: toCatalogCategory(customFormCat),
          unit_cost: cost,
          needs_pricing: cost === 0,
          active: true,
        })
        .select()
        .single()
      if (error || !item) throw new Error(error?.message ?? 'Catalog save failed.')
      // Appears in the pick list immediately
      setCatalog((prev) => (prev ? [...prev, item as CatalogItem] : [item as CatalogItem]))
      await onAdd({
        category: customFormCat,
        label: name,
        unit: (item as CatalogItem).unit,
        quantity: 1,
        unitCost: cost,
        catalogItemId: (item as CatalogItem).id,
      })
      toast.success(`"${name}" saved to your Item Catalog and added.`)
      setCustomFormCat(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add item.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Line Item"
      description={`Adding to ${workAreaName}. Tap items to add — the modal stays open.`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Search */}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search all items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
          />
        </label>

        {loadError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Couldn't load items: {loadError}
          </div>
        )}

        {!loadError && catalog === null && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
            Loading items…
          </div>
        )}

        {!loadError && catalog !== null && (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {GROUPS.map((group) => {
              const groupEntries = filtered.filter((e) => e.category === group.category)
              // Hide fully-empty groups while searching; show all groups
              // (with just the + Custom row) when not searching.
              if (search.trim() && groupEntries.length === 0) return null
              return (
                <div key={group.category} className="overflow-hidden rounded-xl border border-gray-200">
                  <div className={`flex items-center gap-2 border-b px-3 py-2 ${group.tint}`}>
                    {group.icon}
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {group.label}
                    </span>
                    <span className="text-xs opacity-60">({groupEntries.length})</span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {groupEntries.map((entry) => {
                      const added = justAdded.has(entry.key)
                      return (
                        <li key={entry.key}>
                          <button
                            type="button"
                            onClick={() => void handlePick(entry)}
                            disabled={busyKey !== null}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 disabled:opacity-60"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                              {entry.label}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500">
                              {formatUSD(entry.unitCost)} / {entry.unit}
                            </span>
                            {added ? (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : (
                              <Plus className="h-4 w-4 shrink-0 text-gray-300" />
                            )}
                          </button>
                        </li>
                      )
                    })}
                    <li>
                      {customFormCat === group.category ? (
                        /* Inline custom form — saves to Item Catalog + adds */
                        <div className="space-y-2 bg-blue-50/40 px-3 py-2.5">
                          <div className="flex flex-wrap gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={customName}
                              onChange={(e) => setCustomName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleCustomSubmit()
                              }}
                              placeholder={`New ${group.label.toLowerCase()} item name…`}
                              className="min-w-[160px] flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                            />
                            <input
                              type="text"
                              value={customUnit}
                              onChange={(e) => setCustomUnit(e.target.value)}
                              placeholder="Unit"
                              className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                            />
                            <div className="relative w-24">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                                $
                              </span>
                              <DecimalInput
                                value={customCost}
                                onCommit={setCustomCost}
                                placeholder="0.00"
                                ariaLabel="Cost per unit"
                                className="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-5 pr-2 text-right text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">
                              Saves to your Item Catalog, then adds to this estimate.
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setCustomFormCat(null)}
                                className="rounded-md px-2.5 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCustomSubmit()}
                                disabled={busyKey !== null || !customName.trim()}
                                className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
                              >
                                {busyKey === `custom-${group.category}` ? 'Adding…' : 'Add & Save'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCustomForm(group.category)}
                          disabled={busyKey !== null}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-brand-navy transition-colors hover:bg-blue-50/50 disabled:opacity-60"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Custom {group.label.toLowerCase()} item
                        </button>
                      )}
                    </li>
                  </ul>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
