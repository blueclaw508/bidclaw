import { useCallback, useEffect, useState } from 'react'
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
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewWorkAreaModal } from '@/components/project/NewWorkAreaModal'
import {
  WORK_AREA_STATUS_CONFIG,
  WORK_AREA_STATUS_ORDER,
} from '@/lib/statusConfig'
import type { WorkArea, WorkAreaStatus } from '@/lib/types'

interface WorkAreasTabProps {
  projectId: string
  /** Called after any successful CRUD so the parent can refresh totals. */
  onChange?: () => void
}

export default function WorkAreasTab({ projectId, onChange }: WorkAreasTabProps) {
  const [rows, setRows] = useState<WorkArea[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkArea | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('work_areas')
      .select('*')
      .eq('project_id', projectId)
      .order('sequence_order', { ascending: true })
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    setRows((data ?? []) as WorkArea[])
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

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
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
            Work areas
          </h2>
          <p className="text-xs text-brand-text-muted">
            Each discrete scope of work. Drag the grip to reorder.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
        >
          <Plus className="h-4 w-4" />
          Add work area
        </button>
      </header>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load work areas: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && loading && rows.length === 0 && (
        <div className="rounded-xl border border-brand-border bg-white p-6 text-sm text-brand-text-muted">
          Loading work areas…
        </div>
      )}

      {!loadError && !loading && rows.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-brand-border bg-white p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-surface text-brand-navy">
            <ClipboardList className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-brand-text">No work areas yet</h3>
          <p className="mt-1 max-w-xs text-sm text-brand-text-muted">
            Add work areas to break this project into discrete scopes. Each one
            can have its own measurements and line items.
          </p>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
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
            <ul className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-sm">
              {rows.map((wa) => (
                <SortableRow
                  key={wa.id}
                  workArea={wa}
                  expanded={expandedId === wa.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === wa.id ? null : wa.id))
                  }
                  onPatch={(changes) => patch(wa.id, changes)}
                  onDelete={() => setDeleteTarget(wa)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
 * SortableRow — accordion row with grip-handle drag
 * ============================================================ */

function SortableRow({
  workArea,
  expanded,
  onToggle,
  onPatch,
  onDelete,
}: {
  workArea: WorkArea
  expanded: boolean
  onToggle: () => void
  onPatch: (changes: Partial<WorkArea>) => Promise<boolean>
  onDelete: () => void
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
      className="border-b border-brand-border last:border-b-0"
    >
      {/* Row header: grip + chevron-toggle + name + status */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-brand-text-muted hover:bg-brand-surface hover:text-brand-text active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-brand-surface focus:bg-brand-surface focus:outline-none"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-brand-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-brand-text-muted" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-brand-text">
              {workArea.name}
            </span>
            {workArea.description && !expanded && (
              <span className="block truncate text-xs text-brand-text-muted">
                {workArea.description}
              </span>
            )}
          </span>
        </button>
        <span className="shrink-0 font-mono text-[11px] text-brand-text-muted">
          #{workArea.sequence_order + 1}
        </span>
        <StatusBadge kind="work_area" value={workArea.status} className="shrink-0" />
      </div>

      {/* Accordion body */}
      {expanded && (
        <div className="space-y-4 border-t border-brand-border bg-brand-surface px-5 py-4">
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
          <Field label="Status">
            <select
              value={workArea.status}
              onChange={(e) =>
                void onPatch({ status: e.target.value as WorkAreaStatus })
              }
              className={inputClasses}
            >
              {WORK_AREA_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {WORK_AREA_STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
          </Field>
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
 * Inline edit helpers (locally duplicated for now; extract in Phase 5
 * if the pattern shows up a third time outside ProjectDetail/CustomerDetail)
 * ============================================================ */

function BlurSaveInput({
  value,
  onSave,
  className,
}: {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) void onSave(draft)
      }}
      className={className}
    />
  )
}

function BlurSaveTextarea({
  value,
  onSave,
  rows,
}: {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  rows: number
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) void onSave(draft)
      }}
      rows={rows}
      className={inputClasses}
    />
  )
}

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
