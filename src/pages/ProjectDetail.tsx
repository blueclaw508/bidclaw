import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ClipboardList,
  Database,
  FileText,
  Hash,
  Pencil,
  Plus,
  ShieldAlert,
  Sparkles,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewCustomerModal } from '@/components/NewCustomerModal'
import { BlurSaveTextarea } from '@/components/InlineEdit'

// Lazy-loaded so dnd-kit only ships when the Work Areas tab is opened.
const WorkAreasTab = lazy(() => import('@/components/project/WorkAreasTab'))
// Lazy-loaded so react-dropzone only ships when the Files tab is opened.
const FilesTab = lazy(() => import('@/components/project/FilesTab'))
import {
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_ORDER,
} from '@/lib/statusConfig'
import { cn } from '@/lib/utils'
import type { Customer, Project, ProjectStatus } from '@/lib/types'

type ProjectDetail = Project & {
  customers: { id: string; name: string } | null
}

type TabId = 'details' | 'work_areas' | 'files' | 'proposals'

const TABS: { id: TabId; label: string }[] = [
  { id: 'details',    label: 'Details' },
  { id: 'work_areas', label: 'Work Areas' },
  { id: 'files',      label: 'Files' },
  { id: 'proposals',  label: 'Proposals' },
]

export default function ProjectDetailPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') ?? 'details') as TabId
  const setActiveTab = (id: TabId) =>
    setSearchParams({ tab: id }, { replace: true })

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [workAreaCount, setWorkAreaCount] = useState<number | null>(null)
  const [fileCount, setFileCount] = useState<number | null>(null)

  /**
   * Cheap count queries for the totals rail. Run once on mount + when
   * the relevant tab signals a mutation. Uses HEAD count so we don't pull
   * row data we won't display here.
   */
  const refreshCounts = useCallback(async () => {
    if (!projectId) return
    const [{ count: waCount }, { count: fCount }] = await Promise.all([
      supabase
        .from('work_areas')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      supabase
        .from('project_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
    ])
    setWorkAreaCount(waCount ?? 0)
    setFileCount(fCount ?? 0)
  }, [projectId])

  useEffect(() => {
    void refreshCounts()
  }, [refreshCounts])

  const load = useCallback(async () => {
    if (!user || !projectId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*, customers(id, name)')
      .eq('id', projectId)
      .maybeSingle()
    setLoading(false)
    if (error) {
      toast.error(`Couldn't load project: ${error.message}`)
      return
    }
    if (!data) {
      setNotFound(true)
      return
    }
    setProject(data as ProjectDetail)
  }, [user, projectId])

  useEffect(() => {
    void load()
  }, [load])

  /** Patch the project (DB + local state). Returns whether it succeeded. */
  const patch = useCallback(
    async (changes: Partial<Project>): Promise<boolean> => {
      if (!project) return false
      // Optimistic local update so the UI feels responsive
      const previous = project
      setProject({ ...project, ...changes } as ProjectDetail)
      const { data, error } = await supabase
        .from('projects')
        .update(changes)
        .eq('id', project.id)
        .select('*, customers(id, name)')
        .single()
      if (error || !data) {
        setProject(previous)
        toast.error(`Save failed: ${error?.message ?? 'unknown error'}`)
        return false
      }
      setProject(data as ProjectDetail)
      return true
    },
    [project]
  )

  const handleArchive = async () => {
    if (!project) return
    const ok = await patch({ status: 'archived' })
    if (ok) {
      toast.success('Project archived.')
      navigate('/app/projects')
    }
  }

  /* ============================================================
   * Render branches
   * ============================================================ */

  if (loading && !project) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        Loading project…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-bold text-rose-900">Project not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This project doesn't exist, was archived from your visible scope, or
          belongs to a different account.
        </p>
        <Link
          to="/app/projects"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="space-y-6 pb-8">
      {/* Back link — gray with blue hover */}
      <Link
        to="/app/projects"
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to projects
      </Link>

      {/* Gradient project header — QC blue gradient with editable name +
          customer line + status badge. Inline edit pattern preserved
          (click name to edit) but styled to work on the colored
          background (white-translucent input over gradient). */}
      <ProjectHeader project={project} onPatch={patch} />

      {/* Tabs — underline pattern with QC blue active state */}
      <nav
        className="flex flex-wrap gap-1 border-b border-gray-200"
        aria-label="Project sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
              activeTab === t.id
                ? 'border-blue-500 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            )}
            aria-current={activeTab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Main grid: tab content + totals rail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {activeTab === 'details'    && <DetailsTab project={project} onPatch={patch} onArchive={() => setArchiveOpen(true)} />}
          {activeTab === 'work_areas' && (
            <Suspense fallback={<TabLoading />}>
              <WorkAreasTab projectId={project.id} onChange={refreshCounts} />
            </Suspense>
          )}
          {activeTab === 'files'      && (
            <Suspense fallback={<TabLoading />}>
              <FilesTab projectId={project.id} onChange={refreshCounts} />
            </Suspense>
          )}
          {activeTab === 'proposals'  && <ComingSoonTab phase="a later phase" />}
        </div>
        <TotalsRail
          project={project}
          workAreaCount={workAreaCount}
          fileCount={fileCount}
        />
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
        title="Archive this project?"
        description={
          <>
            <strong className="text-gray-900">{project.name}</strong> will be
            set to <em>Archived</em> and hidden from your default project list.
            You can restore it by changing its status back from the Details tab.
          </>
        }
        confirmLabel="Archive"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * ProjectHeader — QC blue gradient card with editable name + customer + status
 * ============================================================ */

function ProjectHeader({
  project,
  onPatch,
}: {
  project: ProjectDetail
  onPatch: (changes: Partial<Project>) => Promise<boolean>
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingName) inputRef.current?.select()
  }, [editingName])

  useEffect(() => {
    if (!editingName) setNameDraft(project.name)
  }, [project.name, editingName])

  const commit = async () => {
    const next = nameDraft.trim()
    if (!next) {
      toast.error('Project name cannot be empty.')
      setNameDraft(project.name)
      setEditingName(false)
      return
    }
    if (next !== project.name) {
      await onPatch({ name: next })
    }
    setEditingName(false)
  }

  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="bg-white/20 p-2 rounded-lg shrink-0">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                ref={inputRef}
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    inputRef.current?.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setNameDraft(project.name)
                    setEditingName(false)
                  }
                }}
                className="w-full rounded-md border border-white/40 bg-white/10 px-3 py-1 text-2xl font-bold text-white placeholder-white/50 outline-none backdrop-blur-sm focus:border-white/70 focus:bg-white/20"
                maxLength={200}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group inline-flex max-w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-2xl font-bold tracking-tight text-white hover:bg-white/10"
                title="Click to edit"
              >
                <span className="truncate">{project.name}</span>
                <Pencil className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-blue-100">
              <User className="h-4 w-4" />
              {project.customers ? (
                <span className="font-medium text-white">
                  {project.customers.name}
                </span>
              ) : (
                <span className="italic">Unassigned</span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge kind="project" value={project.status} className="shrink-0 self-start" />
      </div>
    </div>
  )
}

/* ============================================================
 * DetailsTab — QC pastel section cards
 * ============================================================ */

function DetailsTab({
  project,
  onPatch,
  onArchive,
}: {
  project: ProjectDetail
  onPatch: (changes: Partial<Project>) => Promise<boolean>
  onArchive: () => void
}) {
  return (
    <div className="space-y-6">
      {/* Project Information — indigo pastel */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-indigo-100 flex items-center gap-3">
          <div className="bg-indigo-100 p-2 rounded-lg">
            <ClipboardList className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Project Information</h2>
            <p className="text-xs text-gray-500">
              Status, customer assignment, site address, and notes.
            </p>
          </div>
        </div>
        <div className="p-6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field label="Status">
              <StatusSelect project={project} onPatch={onPatch} />
            </Field>
            <Field label="Customer">
              <CustomerSelect project={project} onPatch={onPatch} />
            </Field>
            <Field label="Site address" className="sm:col-span-2">
              <BlurSaveTextarea
                value={project.site_address ?? ''}
                onSave={(v) => onPatch({ site_address: v || null })}
                rows={2}
                placeholder="Street, city, state, zip"
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <BlurSaveTextarea
                value={project.notes ?? ''}
                onSave={(v) => onPatch({ notes: v || null })}
                rows={4}
                placeholder="Anything worth remembering about this project."
              />
            </Field>
          </dl>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            <div>
              <span className="font-semibold uppercase tracking-wide">Created</span>
              <div className="mt-0.5 text-sm font-normal normal-case text-gray-900">
                {formatLongDate(project.created_at)}
              </div>
            </div>
            <div>
              <span className="font-semibold uppercase tracking-wide">Updated</span>
              <div className="mt-0.5 text-sm font-normal normal-case text-gray-900">
                {formatLongDate(project.updated_at)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone — rose pastel */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-rose-50 to-pink-50 px-6 py-4 border-b border-rose-100 flex items-center gap-3">
          <div className="bg-rose-100 p-2 rounded-lg">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Danger Zone</h2>
            <p className="text-xs text-gray-500">
              Archiving hides the project but preserves its data.
            </p>
          </div>
        </div>
        <div className="p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-600">
              Archive hides the project from your default list but keeps its
              data intact. You can restore it by changing its status.
            </p>
            <button
              type="button"
              onClick={onArchive}
              disabled={project.status === 'archived'}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              {project.status === 'archived' ? 'Already archived' : 'Archive project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusSelect({
  project,
  onPatch,
}: {
  project: ProjectDetail
  onPatch: (changes: Partial<Project>) => Promise<boolean>
}) {
  return (
    <select
      value={project.status}
      onChange={(e) => void onPatch({ status: e.target.value as ProjectStatus })}
      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
    >
      {PROJECT_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {PROJECT_STATUS_CONFIG[s].label}
        </option>
      ))}
    </select>
  )
}

function CustomerSelect({
  project,
  onPatch,
}: {
  project: ProjectDetail
  onPatch: (changes: Partial<Project>) => Promise<boolean>
}) {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<Pick<Customer, 'id' | 'name'>[]>([])
  const [loading, setLoading] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('customers')
      .select('id, name')
      .eq('user_id', user.id)
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) toast.error('Could not load customers.')
        else setCustomers(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  return (
    <>
      <div className="flex gap-2">
        <select
          value={project.customer_id ?? ''}
          onChange={(e) => void onPatch({ customer_id: e.target.value || null })}
          disabled={loading}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-gray-50"
        >
          <option value="">{loading ? 'Loading…' : 'Unassigned'}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setNewCustomerOpen(true)}
          title="Create new customer"
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <NewCustomerModal
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        onCreated={(c) => {
          setCustomers((prev) =>
            [...prev, { id: c.id, name: c.name }].sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          )
          // Auto-assign the new customer to this project
          void onPatch({ customer_id: c.id })
        }}
      />
    </>
  )
}

/* ============================================================
 * Tab content placeholders
 * ============================================================ */

function ComingSoonTab({ phase }: { phase: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <Sparkles className="mx-auto h-8 w-8 text-brand-gold" />
      <h3 className="mt-3 text-base font-semibold text-gray-900">Coming in {phase}</h3>
      <p className="mt-1 text-sm text-gray-500">
        This section is reserved — the foundation is in place but the UI lands later.
      </p>
    </div>
  )
}

/** Suspense fallback for lazy-loaded tab content (e.g. WorkAreasTab + dnd-kit). */
function TabLoading() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
      Loading…
    </div>
  )
}

/* ============================================================
 * Totals rail — QC pastel section cards
 * ============================================================ */

function TotalsRail({
  project,
  workAreaCount,
  fileCount,
}: {
  project: ProjectDetail
  workAreaCount: number | null
  fileCount: number | null
}) {
  // Work-area + file counts are now live (Phases 4 + 6). Estimated value
  // still waits for proposal line items.
  const fmt = (n: number | null) => (n === null ? '—' : String(n))
  return (
    <aside className="space-y-4">
      {/* Project Totals — slate pastel */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-50 to-gray-50 px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="bg-slate-100 p-1.5 rounded-md">
            <Database className="w-4 h-4 text-slate-600" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">Project Totals</h3>
        </div>
        <div className="p-5">
          <dl className="space-y-3 text-sm">
            <TotalRow icon={ClipboardList} label="Work areas"     value={fmt(workAreaCount)} />
            <TotalRow icon={FileText}      label="Files uploaded" value={fmt(fileCount)} />
            <TotalRow icon={Database}      label="Estimated value" value="$0" />
          </dl>
          <p className="mt-4 text-[11px] italic leading-relaxed text-gray-400">
            Estimated value comes online when proposal line items land.
          </p>
        </div>
      </div>

      {/* ID — gray pastel, compact */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="bg-gray-100 p-1.5 rounded-md">
            <Hash className="w-4 h-4 text-gray-500" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">ID</h3>
        </div>
        <div className="p-5">
          <p className="font-mono text-[11px] text-gray-500 break-all">
            {project.id}
          </p>
        </div>
      </div>
    </aside>
  )
}

function TotalRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ClipboardList
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-gray-500">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  )
}

/* ============================================================
 * Local helpers
 * ============================================================ */

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

function formatLongDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
