import { lazy, Suspense, useMemo, useState } from 'react'
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  GripVertical,
  HardHat,
  Layers,
  Package,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { BlurSaveInput, BlurSaveTextarea } from '@/components/InlineEdit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  removeWorkAreaFromProposal,
  updateProposalWorkArea,
} from '@/lib/proposals'
import { ProposalLineRow, validateLine } from '@/components/proposals/ProposalLineRow'

// Lazy-load the 3 add-line modals — they only need to be in the bundle
// after the contractor clicks "+ From kit" / "+ From catalog" / "+ Custom".
// Keeps the ProposalEditor lazy chunk lean (under 50 kB) since the modals
// otherwise tree-shake into it.
const AddFromKitModal = lazy(() =>
  import('@/components/proposals/AddFromKitModal').then((m) => ({
    default: m.AddFromKitModal,
  }))
)
const AddFromCatalogModal = lazy(() =>
  import('@/components/proposals/AddFromCatalogModal').then((m) => ({
    default: m.AddFromCatalogModal,
  }))
)
const AddCustomLineModal = lazy(() =>
  import('@/components/proposals/AddCustomLineModal').then((m) => ({
    default: m.AddCustomLineModal,
  }))
)
import type {
  ProposalLine,
  ProposalLineCategory,
  ProposalWorkAreaResolved,
} from '@/lib/types'

/**
 * QC-style per-work-area card for the proposal editor. Mirrors QC's
 * WorkAreaSection.tsx structure (header row with drag/name/total/
 * toggle/chevron/delete; expandable body with description + per-
 * category subsections) adapted to BidClaw's normalized schema.
 *
 * Phase 2e ships the card chrome and the 5 subsection skeletons
 * (header + column row + per-section markup pill + denormalized
 * subtotal + placeholder "+ Add line item" button). Actual line item
 * rendering + inline editing lands in Phase 2f; Phase 2g wires the
 * "+ Add" affordance to AddFromKitModal + AddFromCatalogModal.
 *
 * Save semantics: name + description edits go save-on-blur via
 * BlurSaveInput / BlurSaveTextarea (matches Prompt 5 KitDetail
 * inline-edit pattern). Toggle + delete are immediate writes.
 */

interface ProposalWorkAreaSectionProps {
  workArea: ProposalWorkAreaResolved
  /** Per-line state driving inline-editable rows (Phase 2f). */
  dirtyLineIds: Set<string>
  linesWithErrors: Set<string>
  saving: boolean
  onLineChange: (lineId: string, patch: Partial<ProposalLine>) => void
  onLineDelete: (lineId: string) => void
  /** Receives the newly-ordered line ids inside the affected subsection. */
  onLineReorder: (orderedIds: string[]) => void
  /** Called after any successful add / update / delete so the parent reloads. */
  onChanged: () => void
}

export default function ProposalWorkAreaSection({
  workArea,
  dirtyLineIds,
  // linesWithErrors is held in the props contract for future use
  // (Phase 2h could highlight subsections with errors); not used today.
  linesWithErrors: _linesWithErrors,
  saving,
  onLineChange,
  onLineDelete,
  onLineReorder,
  onChanged,
}: ProposalWorkAreaSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Add-line modal state — at most one modal open per work area card.
  // The subsection's "+ From kit" / "+ From catalog" / "+ Custom"
  // buttons set this; null closes the modal.
  const [addModal, setAddModal] = useState<
    | { type: 'kit'; category: ProposalLineCategory }
    | { type: 'catalog'; category: 'material' | 'subcontractor' | 'other' }
    | { type: 'custom'; category: ProposalLineCategory }
    | null
  >(null)

  /* ---------- dnd-kit sortable wiring ---------- */

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: workArea.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  /* ---------- save callbacks ---------- */

  const handleSaveName = async (next: string): Promise<boolean> => {
    const trimmed = next.trim()
    if (!trimmed) {
      toast.error('Name cannot be empty.')
      return false
    }
    try {
      await updateProposalWorkArea(workArea.id, { name_override: trimmed })
      onChanged()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
      return false
    }
  }

  const handleSaveDescription = async (next: string): Promise<boolean> => {
    try {
      await updateProposalWorkArea(workArea.id, {
        description_override: next.trim() || null,
      })
      onChanged()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
      return false
    }
  }

  const handleToggleEnabled = async () => {
    try {
      await updateProposalWorkArea(workArea.id, { enabled: !workArea.enabled })
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed.')
    }
  }

  const handleConfirmDelete = async () => {
    setDeleteOpen(false)
    try {
      await removeWorkAreaFromProposal(workArea.id)
      toast.success('Work area removed.')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed.')
    }
  }

  /* ---------- derived values ---------- */

  const isAdHoc = workArea.work_area_id === null

  // The denormalized subtotals on proposal_work_areas are POST-markup
  // per syncProposalWorkAreaSubtotals (verified in Phase 2c smoke test).
  // Card-level total = sum of all 5 category subtotals.
  const workAreaTotal =
    Number(workArea.labor_subtotal) +
    Number(workArea.material_subtotal) +
    Number(workArea.equipment_subtotal) +
    Number(workArea.subcontractor_subtotal) +
    Number(workArea.other_subtotal)

  // Group lines by category for subsection counts. Phase 2f renders the
  // actual lines under each subsection.
  const linesByCategory = useMemo<Record<ProposalLineCategory, ProposalLine[]>>(() => {
    const map: Record<ProposalLineCategory, ProposalLine[]> = {
      labor: [],
      material: [],
      equipment: [],
      subcontractor: [],
      other: [],
    }
    workArea.lines.forEach((l) => map[l.category].push(l))
    return map
  }, [workArea.lines])

  /* ---------- render ---------- */

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <div
        className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-opacity ${
          workArea.enabled
            ? 'border-gray-200'
            : 'border-gray-200 opacity-60'
        }`}
      >
        {/* ─── Header row ─── */}
        <div
          className={`flex items-center gap-2 px-3 py-2.5 ${
            workArea.enabled
              ? 'border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white'
              : 'border-b border-gray-200 bg-zinc-50'
          }`}
        >
          {/* Drag handle */}
          <button
            {...listeners}
            {...attributes}
            aria-label="Drag to reorder"
            className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Layers icon pill */}
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              workArea.enabled
                ? 'bg-slate-200 text-slate-700'
                : 'bg-zinc-200 text-zinc-500'
            }`}
          >
            <Layers className="h-4 w-4" />
          </span>

          {/* Inline-editable name + pills */}
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <div className="relative min-w-0 flex-1">
              <BlurSaveInput
                value={workArea.resolved_name}
                onSave={handleSaveName}
                className="block w-full rounded-md border border-transparent bg-transparent px-2 py-1 pr-7 text-sm font-semibold text-gray-900 outline-none hover:border-gray-200 focus:border-brand-navy focus:bg-white focus:ring-2 focus:ring-brand-navy/20"
                placeholder="Work area name"
              />
              <Pencil className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-300" />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {isAdHoc && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  Ad-hoc
                </span>
              )}
              {!workArea.enabled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700">
                  <ShieldAlert className="h-3 w-3" />
                  Disabled — excluded from grand total
                </span>
              )}
            </div>
          </div>

          {/* Line count + work area subtotal (desktop only) */}
          <span className="hidden whitespace-nowrap text-xs font-medium text-gray-500 sm:inline">
            {workArea.lines.length} line{workArea.lines.length === 1 ? '' : 's'}
            {' · '}
            <span className={workArea.enabled ? 'text-gray-900' : 'text-gray-400'}>
              {formatUSD(workAreaTotal)}
            </span>
          </span>

          {/* Enable/disable toggle slider */}
          <button
            type="button"
            onClick={() => void handleToggleEnabled()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              workArea.enabled ? 'bg-brand-navy' : 'bg-gray-300'
            }`}
            title={
              workArea.enabled
                ? 'Click to exclude from grand total'
                : 'Click to include in grand total'
            }
            aria-label={workArea.enabled ? 'Disable work area' : 'Enable work area'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                workArea.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>

          {/* Collapse/expand chevron */}
          <button
            type="button"
            onClick={() => setIsCollapsed((v) => !v)}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label={isCollapsed ? 'Expand work area' : 'Collapse work area'}
          >
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>

          {/* Delete button */}
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
            aria-label="Remove work area from proposal"
            title="Remove from proposal"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Mobile-only: line count + subtotal strip (header is dense on mobile) */}
        {isCollapsed && (
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500 sm:hidden">
            <span>
              {workArea.lines.length} line{workArea.lines.length === 1 ? '' : 's'}
            </span>
            <span className="font-semibold text-gray-900">
              {formatUSD(workAreaTotal)}
            </span>
          </div>
        )}

        {/* ─── Body (expanded) ─── */}
        {!isCollapsed && (
          <div className="space-y-0">
            {/* Description */}
            <div className="border-b border-gray-100 bg-slate-50/50 px-4 py-3">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Description
                </span>
                <BlurSaveTextarea
                  value={workArea.resolved_description ?? ''}
                  onSave={handleSaveDescription}
                  rows={2}
                  placeholder="Optional description"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
                />
              </label>
            </div>

            {/* 5 per-category subsections — Phase 2f populates with live rows */}
            {(CATEGORY_ORDER as ProposalLineCategory[]).map((cat) => (
              <Subsection
                key={cat}
                category={cat}
                lines={linesByCategory[cat]}
                subtotal={getDenormalizedSubtotal(workArea, cat)}
                dirtyLineIds={dirtyLineIds}
                linesWithErrors={_linesWithErrors}
                disabled={!workArea.enabled || saving}
                onLineChange={onLineChange}
                onLineDelete={onLineDelete}
                onLineReorder={onLineReorder}
                onOpenAddFromKit={() => setAddModal({ type: 'kit', category: cat })}
                onOpenAddOther={() => {
                  if (cat === 'material' || cat === 'subcontractor' || cat === 'other') {
                    setAddModal({ type: 'catalog', category: cat })
                  } else {
                    setAddModal({ type: 'custom', category: cat })
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add-line modals — at most one open at a time per work area.
          Lazy-loaded: the chunk only fetches when the contractor first
          clicks the matching button. We gate the entire <Suspense> on
          `addModal?.type === ...` so the lazy component doesn't even
          mount (and trigger a chunk fetch) until needed. */}
      {addModal?.type === 'kit' && (
        <Suspense fallback={null}>
          <AddFromKitModal
            open
            onClose={() => setAddModal(null)}
            proposalWorkAreaId={workArea.id}
            workAreaName={workArea.resolved_name}
            sourceWorkAreaId={workArea.work_area_id}
            onAdded={onChanged}
          />
        </Suspense>
      )}
      {addModal?.type === 'catalog' && (
        <Suspense fallback={null}>
          <AddFromCatalogModal
            open
            onClose={() => setAddModal(null)}
            proposalWorkAreaId={workArea.id}
            category={addModal.category}
            onAdded={onChanged}
          />
        </Suspense>
      )}
      {addModal?.type === 'custom' && (
        <Suspense fallback={null}>
          <AddCustomLineModal
            open
            onClose={() => setAddModal(null)}
            proposalWorkAreaId={workArea.id}
            category={addModal.category}
            onAdded={onChanged}
          />
        </Suspense>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete this work area from the proposal?"
        description={
          <>
            <strong className="text-brand-text">{workArea.resolved_name}</strong>{' '}
            and its <strong>{workArea.lines.length}</strong> line item
            {workArea.lines.length === 1 ? '' : 's'} will be removed from this
            proposal.{' '}
            {workArea.work_area_id
              ? "The project's work area record is preserved."
              : 'Ad-hoc work area data is permanently lost.'}
          </>
        }
        confirmLabel="Remove"
        tone="danger"
      />
    </li>
  )
}

/* ============================================================
 * Subsection — one category subsection. Renders header + column
 * row + ProposalLineRow per line in this category + subtotal +
 * placeholder "+ Add line item" button (Phase 2g wires).
 * Per-section SortableContext keeps drag-drop scoped to one
 * category — cross-category drags are impossible by construction.
 * ============================================================ */

function Subsection({
  category,
  lines,
  subtotal,
  dirtyLineIds,
  // Reserved for future highlighting of subsections containing errors.
  linesWithErrors: _linesWithErrors,
  disabled,
  onLineChange,
  onLineDelete,
  onLineReorder,
  onOpenAddFromKit,
  onOpenAddOther,
}: {
  category: ProposalLineCategory
  lines: ProposalLine[]
  subtotal: number
  dirtyLineIds: Set<string>
  linesWithErrors: Set<string>
  disabled: boolean
  onLineChange: (lineId: string, patch: Partial<ProposalLine>) => void
  onLineDelete: (lineId: string) => void
  onLineReorder: (orderedIds: string[]) => void
  /** Open AddFromKitModal pre-set to this subsection's category. */
  onOpenAddFromKit: () => void
  /** Open AddFromCatalogModal (material/sub/other) or AddCustomLineModal (labor/equipment). */
  onOpenAddOther: () => void
}) {
  const cfg = CATEGORY_CONFIG[category]
  const Icon = cfg.icon
  // Material/sub/other carry markup; labor/equipment don't. Determined
  // by category alone — settings-markup linkage was removed in Phase 2h
  // cleanup so the UI never implies the line's frozen rate could shift.
  const showMarkupCols =
    category === 'material' ||
    category === 'subcontractor' ||
    category === 'other'

  // Per-subsection sensors so each category drag-drop is independent.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = lines.findIndex((l) => l.id === active.id)
    const newIdx = lines.findIndex((l) => l.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const reordered = arrayMove(lines, oldIdx, newIdx)
    onLineReorder(reordered.map((l) => l.id))
  }

  return (
    <section className="border-b border-gray-100 last:border-b-0">
      {/* Subsection header */}
      <div
        className={`flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 ${cfg.headerBg}`}
      >
        <Icon className={`h-4 w-4 ${cfg.icon_color}`} />
        <h4 className={`text-xs font-semibold uppercase tracking-wide ${cfg.label_color}`}>
          {cfg.label}
        </h4>
        <span className={`text-xs opacity-70 ${cfg.label_color}`}>
          ({lines.length})
        </span>
      </div>

      {/* Column headers — match the row grid */}
      <div className="hidden grid-cols-[1fr_72px_88px_72px_104px_28px] gap-2 border-b border-gray-100 bg-gray-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:grid">
        <div>Item</div>
        <div className="text-right">Qty</div>
        <div className="text-right">{showMarkupCols ? 'Cost' : 'Rate'}</div>
        <div className="text-right">Markup</div>
        <div className="text-right">Price</div>
        <div />
      </div>

      {/* Rows — wrap in a per-subsection DndContext + SortableContext */}
      {lines.length === 0 ? (
        <div className="px-4 py-3 text-center text-[11px] italic text-gray-400">
          No {cfg.label.toLowerCase()} lines yet — use the buttons below to add from a kit or {category === 'labor' || category === 'equipment' ? 'enter a custom line' : 'pick from your catalog'}.
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={lines.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-gray-100">
              {lines.map((l) => (
                <ProposalLineRow
                  key={l.id}
                  line={l}
                  isDirty={dirtyLineIds.has(l.id)}
                  errors={validateLine(l)}
                  onChange={(patch) => onLineChange(l.id, patch)}
                  onDelete={() => onLineDelete(l.id)}
                  disabled={disabled}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Per-subsection add cluster — wired in Phase 2g. Material / sub /
          other show "+ From catalog"; labor / equipment show "+ Custom"
          because their lines don't have a catalog counterpart. */}
      <div className="flex justify-end gap-2 border-t border-gray-100 bg-white px-4 py-2">
        <button
          type="button"
          onClick={onOpenAddFromKit}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          From kit
        </button>
        <button
          type="button"
          onClick={onOpenAddOther}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          {category === 'labor' || category === 'equipment'
            ? 'Custom'
            : 'From catalog'}
        </button>
      </div>

      {/* Subtotal row — only when there's anything in this section */}
      {(lines.length > 0 || subtotal > 0) && (
        <div
          className={`flex items-center justify-between border-t border-gray-100 px-4 py-1.5 text-xs ${cfg.footerBg}`}
        >
          <span className={`font-medium ${cfg.label_color}`}>
            {cfg.label} subtotal
          </span>
          <span className={`font-bold tabular-nums ${cfg.label_color}`}>
            {formatUSD(subtotal)}
          </span>
        </div>
      )}
    </section>
  )
}

/* ============================================================
 * Category config — icons + colors mirror QC's WorkAreaSection
 * ============================================================ */

interface CategoryStyle {
  label: string
  icon: typeof Users
  icon_color: string
  label_color: string
  headerBg: string
  footerBg: string
}

const CATEGORY_ORDER: ProposalLineCategory[] = [
  'labor',
  'material',
  'equipment',
  'subcontractor',
  'other',
]

const CATEGORY_CONFIG: Record<ProposalLineCategory, CategoryStyle> = {
  labor: {
    label: 'Labor',
    icon: Users,
    icon_color: 'text-blue-600',
    label_color: 'text-blue-800',
    headerBg: 'bg-blue-50/60',
    footerBg: 'bg-blue-50/40',
  },
  material: {
    label: 'Materials',
    icon: Package,
    icon_color: 'text-green-600',
    label_color: 'text-green-800',
    headerBg: 'bg-green-50/60',
    footerBg: 'bg-green-50/40',
  },
  equipment: {
    label: 'Equipment',
    icon: Wrench,
    icon_color: 'text-purple-600',
    label_color: 'text-purple-800',
    headerBg: 'bg-purple-50/60',
    footerBg: 'bg-purple-50/40',
  },
  subcontractor: {
    label: 'Subcontractor',
    icon: HardHat,
    icon_color: 'text-orange-600',
    label_color: 'text-orange-800',
    headerBg: 'bg-orange-50/60',
    footerBg: 'bg-orange-50/40',
  },
  other: {
    label: 'Other',
    icon: FileText,
    icon_color: 'text-gray-600',
    label_color: 'text-gray-700',
    headerBg: 'bg-gray-50',
    footerBg: 'bg-gray-50',
  },
}

/* ============================================================
 * Helpers
 * ============================================================ */

function getDenormalizedSubtotal(
  wa: ProposalWorkAreaResolved,
  cat: ProposalLineCategory
): number {
  switch (cat) {
    case 'labor':
      return Number(wa.labor_subtotal)
    case 'material':
      return Number(wa.material_subtotal)
    case 'equipment':
      return Number(wa.equipment_subtotal)
    case 'subcontractor':
      return Number(wa.subcontractor_subtotal)
    case 'other':
      return Number(wa.other_subtotal)
  }
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
