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
  FilePlus,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewWorkAreaModal } from '@/components/project/NewWorkAreaModal'
import { GenerateProposalModal } from '@/components/proposals/GenerateProposalModal'
import { BlurSaveInput, BlurSaveTextarea } from '@/components/InlineEdit'
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
  // Which work area is opening the generate-proposal modal, if any.
  // Held as the full row so the modal has the name + id without
  // another lookup.
  const [generateTarget, setGenerateTarget] = useState<WorkArea | null>(null)

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
                  expanded={expandedId === wa.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === wa.id ? null : wa.id))
                  }
                  onPatch={(changes) => patch(wa.id, changes)}
                  onDelete={() => setDeleteTarget(wa)}
                  onGenerate={() => setGenerateTarget(wa)}
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

      <GenerateProposalModal
        open={generateTarget !== null}
        onClose={() => setGenerateTarget(null)}
        projectId={projectId}
        workArea={generateTarget}
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
  onGenerate,
}: {
  workArea: WorkArea
  expanded: boolean
  onToggle: () => void
  onPatch: (changes: Partial<WorkArea>) => Promise<boolean>
  onDelete: () => void
  onGenerate: () => void
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
        <span className="shrink-0 font-mono text-[11px] text-gray-400">
          #{workArea.sequence_order + 1}
        </span>
        <StatusBadge kind="work_area" value={workArea.status} className="shrink-0" />
        {/* Generate proposal — always enabled per Phase 2a decision 3.
            Stops propagation so the row's chevron-toggle doesn't fire. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onGenerate()
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-navy px-2 py-1 text-xs font-semibold text-white hover:bg-brand-navy-dark"
          title="Generate proposal from this work area"
        >
          <FilePlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Proposal</span>
        </button>
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
