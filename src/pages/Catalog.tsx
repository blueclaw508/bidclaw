import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { NewCatalogItemModal, CATALOG_UNITS } from '@/components/NewCatalogItemModal'
import { BlurSaveInput, BlurSaveTextarea } from '@/components/InlineEdit'
import {
  CATALOG_CATEGORY_CONFIG,
  CATALOG_CATEGORY_ORDER,
} from '@/lib/statusConfig'
import { cn } from '@/lib/utils'
import type { CatalogCategory, CatalogItem } from '@/lib/types'

type CategoryFilter = 'all' | CatalogCategory

export default function CatalogPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<CatalogItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoadError(null)
    const { data, error } = await supabase
      .from('catalog_items')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true })
    if (error) {
      setLoadError(error.message)
      setRows([])
      return
    }
    setRows((data ?? []) as CatalogItem[])
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (id: string, changes: Partial<CatalogItem>): Promise<boolean> => {
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === id ? { ...r, ...changes } : r)) : prev
      )
      const { error } = await supabase
        .from('catalog_items')
        .update(changes)
        .eq('id', id)
      if (error) {
        toast.error(`Save failed: ${error.message}`)
        void load()
        return false
      }
      return true
    },
    [load]
  )

  // Client-side filter + sort
  const visible = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    let r = rows
    if (!showInactive) r = r.filter((i) => i.active)
    if (categoryFilter !== 'all') r = r.filter((i) => i.category === categoryFilter)
    if (q) r = r.filter((i) => i.name.toLowerCase().includes(q))
    return r
  }, [rows, search, categoryFilter, showInactive])

  const totalCount = rows?.length ?? 0
  const hasNone = totalCount === 0

  return (
    <div className="space-y-6 pb-8">
      {/* Gradient page header — QC blue */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Item Catalog</h1>
              <p className="text-blue-100 text-sm mt-0.5">
                Your master list of labor rates, materials, equipment, and disposal lines.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            New item
          </button>
        </div>
      </div>

      {/* Category filter chips */}
      {!hasNone && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <FilterChip
              active={categoryFilter === 'all'}
              onClick={() => setCategoryFilter('all')}
              label="All"
            />
            {CATALOG_CATEGORY_ORDER.map((c) => (
              <FilterChip
                key={c}
                active={categoryFilter === c}
                onClick={() => setCategoryFilter(c)}
                label={CATALOG_CATEGORY_CONFIG[c].label}
              />
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
              />
              Show inactive items
            </label>
          </div>
        </div>
      )}

      {/* Content */}
      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load catalog: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading catalog…
        </div>
      )}

      {!loadError && rows && hasNone && (
        <EmptyState
          icon={BookOpen}
          title="No catalog items yet"
          description="Build your catalog so proposals auto-price. Labor and equipment go in once; every project pulls from here."
          ctaLabel="Add item"
          onCta={() => setNewOpen(true)}
        />
      )}

      {!loadError && rows && !hasNone && visible && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No catalog items match the current filter.
        </div>
      )}

      {!loadError && rows && !hasNone && visible && visible.length > 0 && (
        <ItemList
          rows={visible}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onPatch={patch}
        />
      )}

      <NewCatalogItemModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  )
}

/* ============================================================
 * ItemList — accordion rows in one QC-style card
 * ============================================================ */

function ItemList({
  rows,
  expandedId,
  onToggle,
  onPatch,
}: {
  rows: CatalogItem[]
  expandedId: string | null
  onToggle: (id: string) => void
  onPatch: (id: string, changes: Partial<CatalogItem>) => Promise<boolean>
}) {
  return (
    <ul className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {rows.map((item, idx) => (
        <li
          key={item.id}
          className={cn(
            idx < rows.length - 1 && 'border-b border-gray-100',
            !item.active && 'opacity-60'
          )}
        >
          <ItemRow
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => onToggle(item.id)}
            onPatch={(changes) => onPatch(item.id, changes)}
          />
        </li>
      ))}
    </ul>
  )
}

function ItemRow({
  item,
  expanded,
  onToggle,
  onPatch,
}: {
  item: CatalogItem
  expanded: boolean
  onToggle: () => void
  onPatch: (changes: Partial<CatalogItem>) => Promise<boolean>
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900">{item.name}</span>
            {item.needs_pricing && (
              <span title="Needs pricing">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
              </span>
            )}
            {!item.active && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Inactive
              </span>
            )}
          </div>
          {item.description && (
            <p className="truncate text-xs text-gray-500">{item.description}</p>
          )}
        </div>
        <StatusBadge kind="category" value={item.category} className="shrink-0" />
        <div className="hidden shrink-0 text-right text-xs text-gray-500 sm:block">
          <div className="font-semibold text-gray-900">
            {formatCurrency(item.unit_cost)} / {item.unit}
          </div>
          <div>{Number(item.markup_percent).toFixed(1)}% markup</div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-gray-100 bg-slate-50 px-5 py-4">
          <Field label="Name">
            <BlurSaveInput
              value={item.name}
              onSave={async (v) => {
                const next = v.trim()
                if (!next) {
                  toast.error('Item name cannot be empty.')
                  return false
                }
                return onPatch({ name: next })
              }}
            />
          </Field>
          <Field label="Description">
            <BlurSaveTextarea
              value={item.description ?? ''}
              onSave={(v) => onPatch({ description: v.trim() || null })}
              rows={2}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Unit">
              <select
                value={item.unit}
                onChange={(e) => void onPatch({ unit: e.target.value })}
                className={inputClasses}
              >
                {CATALOG_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={item.category}
                onChange={(e) =>
                  void onPatch({ category: e.target.value as CatalogCategory })
                }
                className={inputClasses}
              >
                {CATALOG_CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATALOG_CATEGORY_CONFIG[c].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit cost">
              <BlurSaveInput
                type="number"
                value={String(item.unit_cost)}
                onSave={(v) => {
                  const n = parseFloat(v)
                  if (Number.isNaN(n) || n < 0) {
                    toast.error('Unit cost must be a non-negative number.')
                    return Promise.resolve(false)
                  }
                  return onPatch({ unit_cost: n })
                }}
              />
            </Field>
            <Field label="Markup percent">
              <BlurSaveInput
                type="number"
                value={String(item.markup_percent)}
                onSave={(v) => {
                  const n = parseFloat(v)
                  if (Number.isNaN(n)) {
                    toast.error('Markup must be a number.')
                    return Promise.resolve(false)
                  }
                  return onPatch({ markup_percent: n })
                }}
              />
            </Field>
          </div>
          <div className="space-y-2.5 rounded-lg border border-gray-200 bg-white p-3">
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={item.active}
                onChange={(e) => void onPatch({ active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
              />
              <span>
                <strong className="font-semibold">Active</strong>
                <span className="text-gray-500">
                  {' '}— uncheck to soft-delete (item stays in DB for historical proposals)
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={item.needs_pricing}
                onChange={(e) => void onPatch({ needs_pricing: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
              />
              <span>
                <strong className="font-semibold">Needs pricing</strong>
                <span className="text-gray-500"> — flagged for Jamie in Phase 2</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </>
  )
}

/* ============================================================
 * helpers
 * ============================================================ */

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'bg-brand-navy text-white'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      )}
    >
      {label}
    </button>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  )
}

function formatCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(n)) return '$0.00'
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'
