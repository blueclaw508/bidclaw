import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewWorkAreaModal } from '@/components/project/NewWorkAreaModal'
import { BlurSaveInput, BlurSaveTextarea } from '@/components/InlineEdit'
import { WorkAreaEstimate } from '@/components/project/estimate/WorkAreaEstimate'
import { loadCompanySettings } from '@/lib/companySettings'
import { generateProposalFromEstimates } from '@/lib/proposals'
import {
  estimateLineTotal,
  formatUSD,
  type LiveMarkupSettings,
} from '@/lib/money'
import type { WorkArea, WorkAreaLine } from '@/lib/types'

interface WorkAreasTabProps {
  projectId: string
  /** For the generated proposal's default name (R4). */
  projectName?: string
  /** Called after any successful CRUD so the parent can refresh totals. */
  onChange?: () => void
}

export default function WorkAreasTab({ projectId, projectName, onChange }: WorkAreasTabProps) {
  const [rows, setRows] = useState<WorkArea[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkArea | null>(null)

  // Estimate-first (R2): each WA's LIVE estimate lines + the current
  // settings markups the live math renders with.
  const [linesByWA, setLinesByWA] = useState<Record<string, WorkAreaLine[]>>({})
  const [settings, setSettings] = useState<LiveMarkupSettings | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    // Embedded select — work areas + their estimate lines in one trip.
    const { data, error } = await supabase
      .from('work_areas')
      .select('*, work_area_lines(*)')
      .eq('project_id', projectId)
      .order('sequence_order', { ascending: true })
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    type RawWA = WorkArea & { work_area_lines: WorkAreaLine[] }
    const raw = (data ?? []) as RawWA[]
    const map: Record<string, WorkAreaLine[]> = {}
    for (const wa of raw) {
      map[wa.id] = (wa.work_area_lines ?? []).sort(
        (a, b) => a.sort_order - b.sort_order
      )
    }
    setLinesByWA(map)
    setRows(
      raw.map(({ work_area_lines: _lines, ...core }) => {
        void _lines
        return core as WorkArea
      })
    )
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  // Current settings markups — loaded once; the estimate math renders
  // live against these (QC model: markup is never frozen on the line).
  useEffect(() => {
    let cancelled = false
    loadCompanySettings()
      .then((s) => {
        if (!cancelled) {
          setSettings({
            markup_materials_percent: s.markup_materials_percent,
            markup_subs_percent: s.markup_subs_percent,
          })
        }
      })
      .catch(() => {
        // Settings missing → render with 0% markup rather than block
        if (!cancelled) {
          setSettings({ markup_materials_percent: 0, markup_subs_percent: 0 })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = useCallback(
    async (id: string, changes: Partial<WorkArea>): Promise<boolean> => {
      // Optimistic update
      setRows((prev) => prev.map((w) => (w.id === id ? { ...w, ...changes } : w)))
      const { error } = await supabase
        .from('work_areas')
        .update(changes)
        .eq('id', id)
      if (error) {
        toast.error(`Save failed: ${error.message}`)
        void load() // re-fetch authoritative state
        return false
      }
      onChange?.()
      return true
    },
    [load, onChange]
  )

  /**
   * Rewrite sequence_order for every row in the current local order.
   * Used on drag-reorder and after-delete to keep numbers contiguous.
   */
  const persistOrder = async (ordered: WorkArea[]): Promise<boolean> => {
    const results = await Promise.all(
      ordered.map((w, idx) =>
        idx === w.sequence_order
          ? Promise.resolve({ error: null })
          : supabase
              .from('work_areas')
              .update({ sequence_order: idx })
              .eq('id', w.id)
      )
    )
    const firstErr = results.find((r) => r.error)
    if (firstErr?.error) {
      toast.error(`Reorder save failed: ${firstErr.error.message}`)
      void load()
      return false
    }
    onChange?.()
    return true
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = rows.findIndex((w) => w.id === active.id)
    const newIdx = rows.findIndex((w) => w.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const reordered = arrayMove(rows, oldIdx, newIdx).map((w, idx) => ({
      ...w,
      sequence_order: idx,
    }))
    setRows(reordered) // optimistic local
    void persistOrder(reordered)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const { error } = await supabase
      .from('work_areas')
      .delete()
      .eq('id', deleteTarget.id)
    if (error) {
      toast.error(`Delete failed: ${error.message}`)
      return
    }
    const remaining = rows
      .filter((w) => w.id !== deleteTarget.id)
      .map((w, idx) => ({ ...w, sequence_order: idx }))
    setRows(remaining)
    setDeleteTarget(null)
    // Resequence the survivors so numbers stay contiguous (1, 2 not 1, 3)
    await persistOrder(remaining)
    toast.success('Work area deleted.')
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /* ---------- render ---------- */

  return (
    <div className="space-y-4">
      {/* Slate pastel section header — matches QC project-detail section card. */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <ClipboardList className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Work areas
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Each discrete scope of work. Drag the grip to reorder.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy-dark"
          >
            <Plus className="h-4 w-4" />
            Add work area
          </button>
        </div>
      </section>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load work areas: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && loading && rows.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading work areas…
        </div>
      )}

      {!loadError && !loading && rows.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <ClipboardList className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">No work areas yet</h3>
          <p className="mt-1 max-w-xs text-sm text-gray-500">
            Add work areas to break this project into discrete scopes. Each one
            can have its own measurements and line items.
          </p>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
          >
            <Plus className="h-4 w-4" />
            Add work area
          </button>
        </div>
      )}

      {!loadError && rows.length > 0 && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={rows.map((w) => w.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {rows.map((wa) => (
                <SortableRow
                  key={wa.id}
                  workArea={wa}
                  lines={linesByWA[wa.id] ?? []}
                  settings={settings}
                  expanded={expandedId === wa.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === wa.id ? null : wa.id))
                  }
                  onPatch={(changes) => patch(wa.id, changes)}
                  onDelete={() => setDeleteTarget(wa)}
                  onLinesChange={(updater) =>
                    setLinesByWA((prev) => ({
                      ...prev,
                      [wa.id]: updater(prev[wa.id] ?? []),
                    }))
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Live project estimate total (R3) — always current, no
          Calculate button needed: instant-save means the numbers can
          never be stale (QC needed Calculate because its state could).
          R4 adds the Create Proposal action — the freeze point. */}
      {!loadError && rows.length > 0 && settings && (
        <ProjectEstimateTotals
          projectId={projectId}
          projectName={projectName}
          rows={rows}
          linesByWA={linesByWA}
          settings={settings}
        />
      )}

      <NewWorkAreaModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        projectId={projectId}
        nextSequenceOrder={rows.length}
        onCreated={() => {
          void load()
          onChange?.()
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this work area?"
        description={
          deleteTarget ? (
            <>
              <strong className="text-brand-text">{deleteTarget.name}</strong>{' '}
              will be permanently deleted along with any measurements and
              line items attached to it. The other work areas will be
              resequenced.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * ProjectEstimateTotals — live rollup across all work areas (R3)
 * ============================================================ */

function ProjectEstimateTotals({
  projectId,
  projectName,
  rows,
  linesByWA,
  settings,
}: {
  projectId: string
  projectName?: string
  rows: WorkArea[]
  linesByWA: Record<string, WorkAreaLine[]>
  settings: LiveMarkupSettings
}) {
  const navigate = useNavigate()
  const [genOpen, setGenOpen] = useState(false)
  const [genName, setGenName] = useState('')
  const [generating, setGenerating] = useState(false)

  const perWA = rows.map((wa) => ({
    wa,
    total: (linesByWA[wa.id] ?? []).reduce(
      (s, l) => s + estimateLineTotal(l, settings),
      0
    ),
    count: (linesByWA[wa.id] ?? []).length,
  }))
  const grand = perWA.reduce((s, x) => s + x.total, 0)
  const approvedCount = rows.filter((w) => w.estimate_status === 'approved').length

  // Preview of what generation will include / skip (client-side mirror
  // of generateProposalFromEstimates' rules).
  const approvedWAs = rows.filter((w) => w.estimate_status === 'approved')
  const approvedLines = approvedWAs.flatMap((w) => linesByWA[w.id] ?? [])
  const skippablePreview = approvedLines.filter(
    (l) => !l.label.trim() || Number(l.quantity) <= 0
  ).length
  const freezableCount = approvedLines.length - skippablePreview
  const approvedTotal = approvedWAs.reduce(
    (s, w) =>
      s +
      (linesByWA[w.id] ?? []).reduce(
        (t, l) => t + estimateLineTotal(l, settings),
        0
      ),
    0
  )

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const { proposalId, lineCount, skipped } = await generateProposalFromEstimates({
        projectId,
        name: genName.trim() || `${projectName ?? 'Project'} — Proposal`,
      })
      toast.success(
        `Proposal created — ${lineCount} line${lineCount === 1 ? '' : 's'} frozen${
          skipped > 0 ? `, ${skipped} unnamed/zero-qty line${skipped === 1 ? '' : 's'} skipped` : ''
        }.`
      )
      navigate(`/app/projects/${projectId}/proposals/${proposalId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed.')
      setGenerating(false)
    }
  }

  if (perWA.every((x) => x.count === 0)) return null

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-blue-800">
          Project Estimate
        </h3>
        <span className="text-xs font-medium text-blue-700">
          {approvedCount} of {rows.length} work area{rows.length === 1 ? '' : 's'} approved
        </span>
      </header>
      <ul className="divide-y divide-gray-100">
        {perWA.map(({ wa, total, count }) => (
          <li key={wa.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-gray-700">{wa.name}</span>
              <StatusBadge kind="estimate" value={wa.estimate_status} />
            </span>
            <span className="shrink-0 tabular-nums text-gray-900">
              {count === 0 ? (
                <span className="text-xs italic text-gray-400">no lines</span>
              ) : (
                formatUSD(total)
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-blue-200 bg-blue-50 px-4 py-3">
        <span className="text-sm font-bold text-blue-900">PROJECT TOTAL</span>
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tabular-nums text-blue-700">
            {formatUSD(grand)}
          </span>
          {/* R4 — THE freeze point. Approved estimates → frozen proposal. */}
          <button
            type="button"
            onClick={() => {
              setGenName(`${projectName ?? 'Project'} — Proposal`)
              setGenOpen(true)
            }}
            disabled={approvedCount === 0}
            title={
              approvedCount === 0
                ? 'Approve at least one work area estimate first'
                : `Generate a proposal from the ${approvedCount} approved work area${approvedCount === 1 ? '' : 's'}`
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            Create Proposal
          </button>
        </div>
      </div>

      {/* Generation confirm — name + what's included / skipped */}
      <ConfirmDialog
        open={genOpen}
        onClose={() => !generating && setGenOpen(false)}
        onConfirm={handleGenerate}
        title="Create proposal from approved estimates?"
        description={
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Proposal name
              </span>
              <input
                type="text"
                value={genName}
                onChange={(e) => setGenName(e.target.value)}
                disabled={generating}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              />
            </label>
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
              <p>
                Freezes{' '}
                <strong>
                  {freezableCount} line{freezableCount === 1 ? '' : 's'}
                </strong>{' '}
                from{' '}
                <strong>
                  {approvedCount} approved work area{approvedCount === 1 ? '' : 's'}
                </strong>{' '}
                at today's rates and markup — <strong>{formatUSD(approvedTotal)}</strong>.
                Settings changes after this won't shift the proposal.
              </p>
              {skippablePreview > 0 && (
                <p className="mt-1.5 font-semibold text-amber-700">
                  {skippablePreview} unnamed or zero-quantity line
                  {skippablePreview === 1 ? '' : 's'} will be skipped — finish
                  them first if they belong in the proposal.
                </p>
              )}
              {approvedCount < rows.length && (
                <p className="mt-1.5 text-blue-700">
                  {rows.length - approvedCount} drafting work area
                  {rows.length - approvedCount === 1 ? ' is' : 's are'} excluded —
                  approve them to include them.
                </p>
              )}
            </div>
          </div>
        }
        confirmLabel={generating ? 'Creating…' : 'Create Proposal'}
        tone="primary"
      />
    </section>
  )
}

/* ============================================================
 * SortableRow — accordion row with grip-handle drag
 * ============================================================ */

function SortableRow({
  workArea,
  lines,
  settings,
  expanded,
  onToggle,
  onPatch,
  onDelete,
  onLinesChange,
}: {
  workArea: WorkArea
  lines: WorkAreaLine[]
  settings: LiveMarkupSettings | null
  expanded: boolean
  onToggle: () => void
  onPatch: (changes: Partial<WorkArea>) => Promise<boolean>
  onDelete: () => void
  onLinesChange: (updater: (prev: WorkAreaLine[]) => WorkAreaLine[]) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: workArea.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border-b border-gray-100 last:border-b-0"
    >
      {/* Row header: grip + chevron-toggle + name + status */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">
              {workArea.name}
            </span>
            {workArea.description && !expanded && (
              <span className="block truncate text-xs text-gray-500">
                {workArea.description}
              </span>
            )}
          </span>
        </button>
        {/* Estimate summary — QC's "N items · $total" header hint */}
        {lines.length > 0 && settings && (
          <span className="hidden shrink-0 whitespace-nowrap text-xs font-medium text-gray-500 sm:inline">
            {lines.length} item{lines.length === 1 ? '' : 's'}
            {' · '}
            <span className="font-semibold text-gray-900">
              {formatUSD(
                lines.reduce((s, l) => s + estimateLineTotal(l, settings), 0)
              )}
            </span>
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-gray-400">
          #{workArea.sequence_order + 1}
        </span>
        {/* Estimate lifecycle badge (R3) — replaces the generic WA status. */}
        <StatusBadge
          kind="estimate"
          value={workArea.estimate_status}
          className="shrink-0"
        />
      </div>

      {/* Accordion body */}
      {expanded && (
        <div className="space-y-4 border-t border-gray-100 bg-slate-50 px-5 py-4">
          <Field label="Name">
            <BlurSaveInput
              value={workArea.name}
              onSave={async (v) => {
                const next = v.trim()
                if (!next) {
                  toast.error('Work area name cannot be empty.')
                  return false
                }
                return onPatch({ name: next })
              }}
              className={inputClasses}
            />
          </Field>
          <Field label="Description">
            <BlurSaveTextarea
              value={workArea.description ?? ''}
              onSave={(v) => onPatch({ description: v.trim() || null })}
              rows={3}
            />
          </Field>

          {/* THE ESTIMATE — line items live here (estimate-first, R2).
              The generic per-WA status picker is gone (R3): the estimate
              lifecycle (Drafting → Approved) IS the work area's status,
              driven by the Approve button in the estimate footer. */}
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Estimate
            </span>
            {settings ? (
              <WorkAreaEstimate
                workArea={workArea}
                lines={lines}
                settings={settings}
                onLinesChange={onLinesChange}
                onToggleApproved={() =>
                  void onPatch({
                    estimate_status:
                      workArea.estimate_status === 'approved'
                        ? 'drafting'
                        : 'approved',
                  })
                }
              />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400">
                Loading rates…
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete work area
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/* ============================================================
 * Inline edit helpers — shared in @/components/InlineEdit
 * ============================================================ */

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

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
