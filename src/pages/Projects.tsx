import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { NewProjectModal } from '@/components/NewProjectModal'
import { PROJECT_STATUS_CONFIG, PROJECT_STATUS_ORDER } from '@/lib/statusConfig'
import type { Project, ProjectStatus } from '@/lib/types'

type ProjectRow = Project & { customers: { name: string } | null }

// "Active" excludes archived; the default daily view.
type StatusFilter = 'active' | 'all' | ProjectStatus
type SortKey = 'created_desc' | 'created_asc' | 'name_asc' | 'updated_desc'

export default function ProjectsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('created_desc')
  const [newOpen, setNewOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoadError(null)
    const { data, error } = await supabase
      .from('projects')
      .select('*, customers(name)')
      .eq('user_id', user.id)
    if (error) {
      setLoadError(error.message)
      setRows([])
      return
    }
    setRows((data ?? []) as ProjectRow[])
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  // Client-side filter + sort. With a single user and modest project counts
  // this is fine; revisit when we cross ~500 rows or add pagination.
  const visible = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    let r = rows
    if (statusFilter === 'active') r = r.filter((p) => p.status !== 'archived')
    else if (statusFilter !== 'all') r = r.filter((p) => p.status === statusFilter)
    if (q) r = r.filter((p) => p.name.toLowerCase().includes(q))
    const sorted = [...r]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'created_asc':
          return a.created_at.localeCompare(b.created_at)
        case 'name_asc':
          return a.name.localeCompare(b.name)
        case 'updated_desc':
          return b.updated_at.localeCompare(a.updated_at)
        case 'created_desc':
        default:
          return b.created_at.localeCompare(a.created_at)
      }
    })
    return sorted
  }, [rows, statusFilter, search, sort])

  const totalCount = rows?.length ?? 0
  const hasNoProjects = totalCount === 0

  return (
    <div className="space-y-6 pb-8">
      {/* Gradient page header — QC blue gradient for visual consistency
          with QC's chrome. Brand-navy stays for primary action buttons
          across BidClaw; gradient HEADERS use QC's blue. */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Projects</h1>
              <p className="text-blue-100 text-sm mt-0.5">
                Every job, from first proposal to signed agreement to done.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
      </div>

      {/* Filter / sort / search controls (hidden when zero projects).
          Icon-prefix search input (QC pattern). */}
      {!hasNoProjects && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'all',    label: 'All statuses' },
                ...PROJECT_STATUS_ORDER.map((s) => ({
                  value: s,
                  label: PROJECT_STATUS_CONFIG[s].label,
                })),
              ]}
            />
            <FilterSelect
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={[
                { value: 'created_desc', label: 'Newest first' },
                { value: 'created_asc',  label: 'Oldest first' },
                { value: 'updated_desc', label: 'Recently updated' },
                { value: 'name_asc',     label: 'Name A→Z' },
              ]}
            />
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Search by project name…"
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
          Couldn't load projects: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading projects…
        </div>
      )}

      {!loadError && rows && hasNoProjects && (
        <EmptyState
          icon={ClipboardList}
          title="No projects yet"
          description="Create your first project to start tracking customers, work areas, measurements, and proposals."
          ctaLabel="New project"
          onCta={() => setNewOpen(true)}
        />
      )}

      {!loadError && rows && !hasNoProjects && visible && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No projects match the current filter.
        </div>
      )}

      {!loadError && rows && !hasNoProjects && visible && visible.length > 0 && (
        <ProjectList rows={visible} />
      )}

      <NewProjectModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          void load()
        }}
      />
    </div>
  )
}

/* ============================================================
 * ProjectList — one big QC-style card with bordered rows.
 * slate-50 table header on desktop; stacked mobile rows.
 * ============================================================ */

function ProjectList({ rows }: { rows: ProjectRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* slate-50 header row — desktop only. Neutral pastel because
          list pages aren't semantically color-coded like QC's settings
          cards. */}
      <div className="hidden grid-cols-[1fr_minmax(0,200px)_120px_120px_120px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div>Project</div>
        <div>Customer</div>
        <div>Status</div>
        <div>Created</div>
        <div>Updated</div>
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              to={`/app/projects/${p.id}`}
              className="block transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              {/* Desktop layout */}
              <div className="hidden grid-cols-[1fr_minmax(0,200px)_120px_120px_120px] items-center gap-4 px-6 py-4 lg:grid">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                  {p.site_address && (
                    <div className="truncate text-xs text-gray-500">{p.site_address}</div>
                  )}
                </div>
                <div className="truncate text-sm text-gray-600">
                  {p.customers?.name ?? <span className="italic text-gray-400">Unassigned</span>}
                </div>
                <div>
                  <StatusBadge kind="project" value={p.status} />
                </div>
                <div className="text-sm text-gray-500">{formatShortDate(p.created_at)}</div>
                <div className="text-sm text-gray-500">{formatShortDate(p.updated_at)}</div>
              </div>

              {/* Mobile layout */}
              <div className="flex flex-col gap-2 px-4 py-4 lg:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                    {p.site_address && (
                      <div className="truncate text-xs text-gray-500">{p.site_address}</div>
                    )}
                  </div>
                  <StatusBadge kind="project" value={p.status} className="shrink-0" />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{p.customers?.name ?? 'Unassigned'}</span>
                  <span>Updated {formatShortDate(p.updated_at)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- helpers ---------- */

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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
