import { lazy, Suspense, useMemo, useState } from 'react'
import { FileText, HardHat, Package, Percent, Plus, Users, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import {
  addWorkAreaLine,
  deleteWorkAreaLine,
  updateWorkAreaLine,
} from '@/lib/workAreaLines'
import {
  categoryBearsMarkup,
  estimateLineTotal,
  formatUSD,
  liveMarkupPercent,
  type LiveMarkupSettings,
} from '@/lib/money'
import {
  PROPOSAL_LINE_CATEGORY_LABELS,
  PROPOSAL_LINE_CATEGORY_ORDER,
} from '@/lib/statusConfig'
import { WorkAreaLineRow } from '@/components/project/estimate/WorkAreaLineRow'
import type { AddLinePayload } from '@/components/project/estimate/AddLineItemModal'
import type { ProposalLineCategory, WorkArea, WorkAreaLine } from '@/lib/types'

const AddLineItemModal = lazy(() =>
  import('@/components/project/estimate/AddLineItemModal').then((m) => ({
    default: m.AddLineItemModal,
  }))
)

/**
 * The ESTIMATE for one work area (estimate-first rework, R2). Lives
 * inside the WorkAreasTab accordion body. QC-faithful:
 *
 *   • only categories WITH lines render (no empty subsections)
 *   • live markup pill on markup-bearing group headers
 *   • per-category subtotal + work-area total
 *   • ONE "+ Add Line Item" dashed button → full-catalog modal
 *   • INSTANT SAVE — optimistic local, immediate DB write, no Save bar
 *
 * State ownership: the parent (WorkAreasTab) holds linesByWorkArea so
 * collapsed headers can show "N items · $total" without mounting this
 * component. Mutations here go through the parent's setter.
 */

const CATEGORY_ICONS: Record<ProposalLineCategory, React.ReactNode> = {
  labor: <Users className="h-3.5 w-3.5" />,
  material: <Package className="h-3.5 w-3.5" />,
  equipment: <Wrench className="h-3.5 w-3.5" />,
  subcontractor: <HardHat className="h-3.5 w-3.5" />,
  other: <FileText className="h-3.5 w-3.5" />,
}

const CATEGORY_TINTS: Record<ProposalLineCategory, string> = {
  labor: 'bg-indigo-50 text-indigo-700',
  material: 'bg-sky-50 text-sky-700',
  equipment: 'bg-amber-50 text-amber-700',
  subcontractor: 'bg-orange-50 text-orange-700',
  other: 'bg-slate-100 text-slate-700',
}

interface WorkAreaEstimateProps {
  workArea: WorkArea
  lines: WorkAreaLine[]
  settings: LiveMarkupSettings
  /** Replace this WA's lines in the parent's state (optimistic + confirmed). */
  onLinesChange: (updater: (prev: WorkAreaLine[]) => WorkAreaLine[]) => void
}

export function WorkAreaEstimate({
  workArea,
  lines,
  settings,
  onLinesChange,
}: WorkAreaEstimateProps) {
  const [addOpen, setAddOpen] = useState(false)

  const byCategory = useMemo(() => {
    const map: Record<ProposalLineCategory, WorkAreaLine[]> = {
      labor: [],
      material: [],
      equipment: [],
      subcontractor: [],
      other: [],
    }
    for (const l of [...lines].sort((a, b) => a.sort_order - b.sort_order)) {
      map[l.category].push(l)
    }
    return map
  }, [lines])

  const workAreaTotal = useMemo(
    () => lines.reduce((sum, l) => sum + estimateLineTotal(l, settings), 0),
    [lines, settings]
  )

  /* ---------- instant-save mutators (optimistic + DB) ---------- */

  const handleAdd = async (payload: AddLinePayload) => {
    const sortOrder = lines.length
      ? Math.max(...lines.map((l) => l.sort_order)) + 1
      : 0
    // DB first (needs the generated id), then local. Adds are the one
    // mutation where a round-trip before paint is acceptable — the
    // modal shows its own busy state.
    const created = await addWorkAreaLine({
      workAreaId: workArea.id,
      category: payload.category,
      label: payload.label,
      unit: payload.unit,
      quantity: payload.quantity,
      unitCost: payload.unitCost,
      sortOrder,
      catalogItemId: payload.catalogItemId ?? null,
    })
    onLinesChange((prev) => [...prev, created])
  }

  const handlePatch = (line: WorkAreaLine, patch: Partial<WorkAreaLine>) => {
    // Optimistic local, then DB; revert by refetching the row on error.
    onLinesChange((prev) =>
      prev.map((l) => (l.id === line.id ? { ...l, ...patch } : l))
    )
    void updateWorkAreaLine(line.id, patch).catch((err) => {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
      onLinesChange((prev) => prev.map((l) => (l.id === line.id ? line : l)))
    })
  }

  const handleDelete = (line: WorkAreaLine) => {
    onLinesChange((prev) => prev.filter((l) => l.id !== line.id))
    void deleteWorkAreaLine(line.id).catch((err) => {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
      onLinesChange((prev) =>
        [...prev, line].sort((a, b) => a.sort_order - b.sort_order)
      )
    })
  }

  /* ---------- render ---------- */

  return (
    <div className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50/30">
      {/* Only-populated categories (QC model — no empty subsections) */}
      {PROPOSAL_LINE_CATEGORY_ORDER.map((cat) => {
        const catLines = byCategory[cat]
        if (catLines.length === 0) return null
        const bearsMarkup = categoryBearsMarkup(cat)
        const markupPct = liveMarkupPercent(cat, settings)
        const subtotal = catLines.reduce(
          (s, l) => s + estimateLineTotal(l, settings),
          0
        )
        return (
          <div key={cat} className="border-b border-blue-100/70 last:border-b-0">
            <div className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 ${CATEGORY_TINTS[cat]}`}>
              {CATEGORY_ICONS[cat]}
              <h4 className="text-[11px] font-bold uppercase tracking-wide">
                {PROPOSAL_LINE_CATEGORY_LABELS[cat]}
              </h4>
              <span className="text-[11px] opacity-60">({catLines.length})</span>
              {bearsMarkup && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] opacity-80">
                  <Percent className="h-3 w-3" />
                  {markupPct.toFixed(2)}% markup
                </span>
              )}
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 sm:gap-3 sm:px-4">
              <div className="min-w-[140px] flex-[2]">Item</div>
              <div className="w-16 text-right sm:w-20">Qty</div>
              <div className="w-20 text-right sm:w-24">Cost</div>
              <div className="w-16 text-right sm:w-20">Markup</div>
              <div className="w-24 text-right sm:w-28">Price</div>
              <div className="w-5 shrink-0" />
            </div>

            <div className="divide-y divide-blue-50">
              {catLines.map((l) => (
                <WorkAreaLineRow
                  key={l.id}
                  line={l}
                  settings={settings}
                  onPatch={(patch) => handlePatch(l, patch)}
                  onDelete={() => handleDelete(l)}
                />
              ))}
            </div>

            {catLines.length > 1 && (
              <div className={`flex items-center justify-between border-t border-gray-100 px-3 py-1 text-[11px] sm:px-4 ${CATEGORY_TINTS[cat]} bg-opacity-40`}>
                <span className="font-medium">
                  {PROPOSAL_LINE_CATEGORY_LABELS[cat]} subtotal
                </span>
                <span className="font-bold tabular-nums">{formatUSD(subtotal)}</span>
              </div>
            )}
          </div>
        )
      })}

      {/* "+ Add Line Item" — the ONE entry point (QC model) */}
      <div className="p-3">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 py-2.5 text-sm font-medium text-blue-600 transition-all hover:bg-blue-100/60"
        >
          <Plus className="h-4 w-4" />
          Add Line Item
        </button>
      </div>

      {/* Work area total */}
      {lines.length > 0 && (
        <div className="flex items-center justify-between border-t border-blue-200 bg-blue-100/70 px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-800">
            Total {workArea.name}
          </span>
          <span className="text-lg font-bold tabular-nums text-blue-700">
            {formatUSD(workAreaTotal)}
          </span>
        </div>
      )}

      {lines.length === 0 && (
        <div className="pb-4 text-center text-sm text-gray-400">
          No line items yet. Click{' '}
          <span className="font-semibold text-blue-500">"+ Add Line Item"</span>{' '}
          to build this work area's estimate.
        </div>
      )}

      {addOpen && (
        <Suspense fallback={null}>
          <AddLineItemModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            workAreaName={workArea.name}
            onAdd={handleAdd}
          />
        </Suspense>
      )}
    </div>
  )
}
