import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Plus,
  Search,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { NewKitModal } from '@/components/kits/NewKitModal'
import { BlurSaveInput } from '@/components/InlineEdit'
import {
  archiveKit,
  loadKits,
  unarchiveKit,
  updateKit,
} from '@/lib/kits'
import type { Kit, KitStatus } from '@/lib/types'

/**
 * Kit list. QC blue gradient header (Prompt 4.5 list pattern) + slate-50
 * neutral list. Filters: category, branch scope, search. Active/Archived
 * toggle controls which subset is shown — default Active, since most
 * day-to-day reads want the working set.
 */

type KitWithLineCount = Kit & { line_count: number }

export default function KitsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<KitWithLineCount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<KitStatus>('active')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const kits = await loadKits()
      // Line counts are fetched in a second round-trip so the kits
      // query stays simple. Counts are denormalized here only for the
      // list row display — never used as a source of truth for the
      // detail page (which reloads lines fresh).
      const lineCounts = await fetchLineCounts(kits.map((k) => k.id))
      setRows(
        kits.map((k) => ({
          ...k,
          line_count: lineCounts[k.id] ?? 0,
        }))
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load kits.')
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Distinct values for the filter dropdowns. Computed from rows so
  // contractors only see categories/scopes they actually use.
  const allCategories = useMemo(() => {
    if (!rows) return [] as string[]
    return Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort()
  }, [rows])

  const allBranchScopes = useMemo(() => {
    if (!rows) return [] as string[]
    return Array.from(
      new Set(rows.map((r) => r.branch_scope ?? '').filter(Boolean))
    ).sort()
  }, [rows])

  const visible = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    let r = rows.filter((k) => k.status === statusFilter)
    if (categoryFilter !== 'all')
      r = r.filter((k) => k.category === categoryFilter)
    if (branchFilter !== 'all')
      r = r.filter((k) => (k.branch_scope ?? '') === branchFilter)
    if (q) r = r.filter((k) => k.name.toLowerCase().includes(q))
    return [...r].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, statusFilter, categoryFilter, branchFilter, search])

  const totalCount = rows?.length ?? 0
  const hasNone = totalCount === 0

  /** Inline-edit save handler for a kit name from the list row. */
  const handleRenameKit = useCallback(
    async (id: string, next: string): Promise<boolean> => {
      const trimmed = next.trim()
      if (!trimmed) {
        toast.error('Kit name cannot be empty.')
        return false
      }
      try {
        const updated = await updateKit(id, { name: trimmed })
        setRows((prev) =>
          prev
            ? prev.map((r) => (r.id === id ? { ...r, ...updated } : r))
            : prev
        )
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Save failed.')
        return false
      }
    },
    []
  )

  const handleArchive = useCallback(async (id: string) => {
    try {
      const updated = await archiveKit(id)
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === id ? { ...r, ...updated } : r)) : prev
      )
      toast.success('Kit archived.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Archive failed.')
    }
  }, [])

  const handleUnarchive = useCallback(async (id: string) => {
    try {
      const updated = await unarchiveKit(id)
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === id ? { ...r, ...updated } : r)) : prev
      )
      toast.success('Kit restored.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed.')
    }
  }, [])

  return (
    <div className="space-y-6 pb-8">
      {/* Gradient page header — QC blue */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Wrench className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Kits</h1>
              <p className="text-blue-100 text-sm mt-0.5">
                Your work-type calculation recipes. Each kit's factors get
                multiplied by a work area's quantity to generate proposal
                line items.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            New kit
          </button>
        </div>
      </div>

      {/* Filter / sort / search controls (hidden when zero kits). */}
      {!hasNone && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as KitStatus)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <FilterSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: 'all', label: 'All categories' },
                ...allCategories.map((c) => ({ value: c, label: c })),
              ]}
            />
            {allBranchScopes.length > 0 && (
              <FilterSelect
                value={branchFilter}
                onChange={setBranchFilter}
                options={[
                  { value: 'all', label: 'All branches' },
                  ...allBranchScopes.map((b) => ({ value: b, label: b })),
                ]}
              />
            )}
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Search by kit name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>
        </div>
      )}

      {/* Content */}
      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load kits: {loadError}{' '}
          <button
            onClick={() => void load()}
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading kits…
        </div>
      )}

      {!loadError && rows && hasNone && (
        <EmptyState
          icon={Wrench}
          title="No kits yet"
          description="Kits are recipes for your work types — patios, walls, drives, planting. Each kit's labor and material factors get multiplied by your work area's quantity to generate proposal line items. Click New kit to get started."
          ctaLabel="New kit"
          onCta={() => setNewOpen(true)}
        />
      )}

      {!loadError && rows && !hasNone && visible && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No kits match the current filter.
        </div>
      )}

      {!loadError && rows && !hasNone && visible && visible.length > 0 && (
        <KitList
          rows={visible}
          onOpen={(id) => navigate(`/app/kits/${id}`)}
          onRename={handleRenameKit}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
        />
      )}

      <NewKitModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        existingCategories={allCategories}
        existingBranchScopes={allBranchScopes}
        onCreated={(kit) => {
          // Push the new row in immediately so the list reflects it
          // before the navigate. Line count is 0 for a brand-new kit.
          setRows((prev) => (prev ? [{ ...kit, line_count: 0 }, ...prev] : prev))
          // Hand off to the detail page so the contractor can add lines.
          navigate(`/app/kits/${kit.id}`)
        }}
      />
    </div>
  )
}

/* ============================================================
 * KitList — one big QC-style card with slate-50 header
 * ============================================================ */

function KitList({
  rows,
  onOpen,
  onRename,
  onArchive,
  onUnarchive,
}: {
  rows: KitWithLineCount[]
  onOpen: (id: string) => void
  onRename: (id: string, next: string) => Promise<boolean>
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Desktop header row */}
      <div className="hidden grid-cols-[1.5fr_140px_80px_80px_100px_120px_88px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div>Name</div>
        <div>Category</div>
        <div>Unit</div>
        <div>Lines</div>
        <div>Branch</div>
        <div>Updated</div>
        <div className="text-right">Actions</div>
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map((k) => (
          <li key={k.id}>
            {/* Desktop layout */}
            <div className="hidden grid-cols-[1.5fr_140px_80px_80px_100px_120px_88px] items-center gap-4 px-6 py-3 lg:grid">
              {/* Name cell — inline-editable. stopPropagation so editing
                  doesn't bubble to the row-level open handler. */}
              <div
                className="min-w-0"
                onClick={(e) => e.stopPropagation()}
              >
                <BlurSaveInput
                  value={k.name}
                  onSave={(v) => onRename(k.id, v)}
                  className="block w-full truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-gray-900 outline-none hover:border-gray-200 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                />
              </div>
              <div className="truncate">
                <CategoryBadge category={k.category} />
              </div>
              <div className="text-sm text-gray-600">{k.input_unit}</div>
              <div className="text-sm text-gray-900">{k.line_count}</div>
              <div className="truncate text-sm text-gray-600">
                {k.branch_scope ?? <span className="italic text-gray-400">—</span>}
              </div>
              <div className="text-sm text-gray-500">
                {formatShortDate(k.updated_at)}
              </div>
              <div className="flex items-center justify-end gap-1">
                <ArchiveButton
                  status={k.status}
                  onArchive={() => onArchive(k.id)}
                  onUnarchive={() => onUnarchive(k.id)}
                />
                <button
                  type="button"
                  onClick={() => onOpen(k.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand-navy"
                  title="Open kit"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mobile layout */}
            <div className="flex flex-col gap-2 px-4 py-4 lg:hidden">
              <div className="flex items-start justify-between gap-3">
                <div
                  className="min-w-0 flex-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <BlurSaveInput
                    value={k.name}
                    onSave={(v) => onRename(k.id, v)}
                    className="block w-full truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-gray-900 outline-none hover:border-gray-200 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                  />
                </div>
                <CategoryBadge category={k.category} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  per {k.input_unit} · {k.line_count} line
                  {k.line_count === 1 ? '' : 's'}
                  {k.branch_scope ? ` · ${k.branch_scope}` : ''}
                </span>
                <span>Updated {formatShortDate(k.updated_at)}</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpen(k.id)}
                  className="flex-1 rounded-md bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy-dark"
                >
                  Open
                </button>
                <ArchiveButton
                  status={k.status}
                  onArchive={() => onArchive(k.id)}
                  onUnarchive={() => onUnarchive(k.id)}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * Pull line counts for a set of kits in one query. Supabase doesn't
 * expose GROUP BY directly in the JS client, so we fetch (id, kit_id)
 * for all matching rows and count client-side. For typical kit
 * libraries (<100 kits × ~15 lines each) the payload is small.
 */
async function fetchLineCounts(kitIds: string[]): Promise<Record<string, number>> {
  if (kitIds.length === 0) return {}
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await supabase
    .from('kit_lines')
    .select('kit_id')
    .in('kit_id', kitIds)
  if (error) {
    throw new Error(`Couldn't load line counts: ${error.message}`)
  }
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const id = (row as { kit_id: string }).kit_id
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      {category}
    </span>
  )
}

function ArchiveButton({
  status,
  onArchive,
  onUnarchive,
}: {
  status: KitStatus
  onArchive: () => void
  onUnarchive: () => void
}) {
  if (status === 'active') {
    return (
      <button
        type="button"
        onClick={onArchive}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-amber-50 hover:text-amber-700"
        title="Archive kit"
      >
        <Archive className="h-4 w-4" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onUnarchive}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-green-50 hover:text-green-700"
      title="Restore kit"
    >
      <ArchiveRestore className="h-4 w-4" />
    </button>
  )
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
