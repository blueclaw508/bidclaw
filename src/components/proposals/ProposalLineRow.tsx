import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { categoryBearsMarkup, formatUSD, lineTotal } from '@/lib/money'
import type { ProposalLine } from '@/lib/types'

/**
 * Inline-editable line row inside a category subsection.
 *
 * Save semantics (Phase 2f): edits flow upward via `onChange(patch)`;
 * the parent ProposalEditor maintains a local-draft map keyed by line
 * id. A unified sticky Save+Reset bar (notes + lines) commits all
 * dirty rows in a single batch via updateProposalLine and then re-
 * syncs each affected proposal_work_area's denormalized subtotals.
 *
 * Markup column behavior (Phase 3a):
 *   • Material / subcontractor / other → editable DecimalInput, 0..200,
 *     "%" visual suffix, stored as plain number
 *   • Labor / equipment → fixed at 0 by KYN convention (rates already
 *     include margin); renders "—" non-editable
 *
 * Price column is computed display: qty × cost × (1 + markup/100).
 * The same formula works across all categories because labor + equipment
 * carry frozen_markup_percent=0, so the (1 + 0/100) multiplier is a no-op.
 *
 * Validation (matches Prompt 5 KitDetail inline pattern):
 *   • label must be non-empty
 *   • quantity > 0 (DB CHECK rejects 0 / negative)
 *   • frozen_unit_cost >= 0 (DB CHECK rejects negative)
 *   • frozen_markup_percent in [0, 200] for material/sub/other; skipped
 *     for labor/equipment (always valid since markup=0 by convention)
 * Errors surface as rose border + Save-disabled signal at the parent.
 */

interface ProposalLineRowProps {
  /** Current displayed line (parent's local draft, falling back to server snapshot). */
  line: ProposalLine
  /** True when the line is in the parent's dirty set. Used for visual hint. */
  isDirty: boolean
  /** Per-field validation flags computed by the parent. */
  errors: {
    nameInvalid: boolean
    quantityInvalid: boolean
    costInvalid: boolean
    markupInvalid: boolean
  }
  /** Emit a partial patch to the parent's local draft state. */
  onChange: (patch: Partial<ProposalLine>) => void
  onDelete: () => void
  /** True when the parent work area is disabled OR save is in flight. */
  disabled?: boolean
}

export function ProposalLineRow({
  line,
  isDirty,
  errors,
  onChange,
  onDelete,
  disabled = false,
}: ProposalLineRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const price = lineTotal(line)
  const showMarkup = categoryBearsMarkup(line.category)
  const hasError =
    errors.nameInvalid ||
    errors.quantityInvalid ||
    errors.costInvalid ||
    errors.markupInvalid

  return (
    <div ref={setNodeRef} style={style}>
      {/* Desktop grid — mirrors the column header layout from the subsection */}
      <div
        className={`hidden grid-cols-[1fr_72px_88px_72px_104px_28px] items-center gap-2 px-4 py-2 lg:grid ${
          hasError ? 'bg-rose-50/40' : isDirty ? 'bg-amber-50/40' : ''
        }`}
      >
        {/* Item — drag handle + name input share the 1fr cell */}
        <div className="flex min-w-0 items-center gap-1">
          <button
            {...listeners}
            {...attributes}
            disabled={disabled}
            aria-label="Drag to reorder"
            className="flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-gray-300 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <input
            type="text"
            value={line.label}
            onChange={(e) => onChange({ label: e.target.value })}
            disabled={disabled}
            placeholder="Line label"
            className={cellInputClasses(errors.nameInvalid)}
            title={errors.nameInvalid ? 'Name is required.' : undefined}
          />
        </div>

        {/* Qty */}
        <DecimalInput
          value={line.quantity}
          onCommit={(n) => onChange({ quantity: n ?? NaN })}
          disabled={disabled}
          placeholder="0"
          className={`${cellInputClasses(errors.quantityInvalid)} text-right`}
          title={errors.quantityInvalid ? 'Quantity must be greater than 0.' : undefined}
        />

        {/* Cost (frozen_unit_cost) — editable in Phase 2f per spec decision */}
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            $
          </span>
          <DecimalInput
            value={line.frozen_unit_cost}
            onCommit={(n) => onChange({ frozen_unit_cost: n ?? NaN })}
            disabled={disabled}
            placeholder="0.00"
            className={`${cellInputClasses(errors.costInvalid)} pl-5 text-right`}
            title={errors.costInvalid ? 'Cost must be 0 or greater.' : undefined}
          />
        </div>

        {/* Markup — editable DecimalInput for material/sub/other; '—' for labor/equipment. */}
        {showMarkup ? (
          <div className="relative">
            <DecimalInput
              value={line.frozen_markup_percent}
              onCommit={(n) => onChange({ frozen_markup_percent: n ?? NaN })}
              disabled={disabled}
              placeholder="0"
              className={`${cellInputClasses(errors.markupInvalid)} pr-5 text-right`}
              title={errors.markupInvalid ? 'Markup must be between 0 and 200.' : undefined}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              %
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-end text-xs text-gray-400">—</div>
        )}

        {/* Price — computed display */}
        <div className="text-right text-sm font-semibold tabular-nums text-gray-900">
          {formatUSD(price)}
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label="Delete line"
          title="Delete line"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mobile stacked card */}
      <div
        className={`flex flex-col gap-2 px-4 py-3 lg:hidden ${
          hasError ? 'bg-rose-50/40' : isDirty ? 'bg-amber-50/40' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            {...listeners}
            {...attributes}
            disabled={disabled}
            aria-label="Drag to reorder"
            className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-gray-300 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <input
            type="text"
            value={line.label}
            onChange={(e) => onChange({ label: e.target.value })}
            disabled={disabled}
            placeholder="Line label"
            className={`${cellInputClasses(errors.nameInvalid)} flex-1`}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <LabeledMobileField label="Qty">
            <DecimalInput
              value={line.quantity}
              onCommit={(n) => onChange({ quantity: n ?? NaN })}
              disabled={disabled}
              className={`${cellInputClasses(errors.quantityInvalid)} text-right`}
            />
          </LabeledMobileField>
          <LabeledMobileField label="Cost">
            <DecimalInput
              value={line.frozen_unit_cost}
              onCommit={(n) => onChange({ frozen_unit_cost: n ?? NaN })}
              disabled={disabled}
              className={`${cellInputClasses(errors.costInvalid)} text-right`}
            />
          </LabeledMobileField>
          <LabeledMobileField label="Markup">
            {showMarkup ? (
              <div className="relative">
                <DecimalInput
                  value={line.frozen_markup_percent}
                  onCommit={(n) => onChange({ frozen_markup_percent: n ?? NaN })}
                  disabled={disabled}
                  placeholder="0"
                  className={`${cellInputClasses(errors.markupInvalid)} pr-5 text-right`}
                  title={errors.markupInvalid ? 'Markup must be between 0 and 200.' : undefined}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  %
                </span>
              </div>
            ) : (
              <div className="rounded-md border border-transparent px-2 py-1.5 text-right text-xs text-gray-400">
                —
              </div>
            )}
          </LabeledMobileField>
          <LabeledMobileField label="Price">
            <div className="rounded-md border border-transparent px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-gray-900">
              {formatUSD(price)}
            </div>
          </LabeledMobileField>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Validation + computed value helpers (exported — parent uses them)
 * ============================================================ */

export interface LineErrors {
  nameInvalid: boolean
  quantityInvalid: boolean
  costInvalid: boolean
  markupInvalid: boolean
}

/** Pure validator. Parent runs this on every local line to decide Save-disabled state + per-cell border. */
export function validateLine(line: ProposalLine): LineErrors {
  // Markup validation only applies to categories that bear markup.
  // Labor + equipment carry frozen_markup_percent=0 by KYN convention
  // and the column is non-editable in the UI, so we never flag them.
  const markupRelevant = categoryBearsMarkup(line.category)
  const m = Number(line.frozen_markup_percent)
  const markupInvalid = markupRelevant
    ? !Number.isFinite(m) || m < 0 || m > 200
    : false
  return {
    nameInvalid: !line.label || !line.label.trim(),
    quantityInvalid: !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0,
    costInvalid:
      !Number.isFinite(Number(line.frozen_unit_cost)) || Number(line.frozen_unit_cost) < 0,
    markupInvalid,
  }
}

export function lineHasErrors(line: ProposalLine): boolean {
  const e = validateLine(line)
  return e.nameInvalid || e.quantityInvalid || e.costInvalid || e.markupInvalid
}

// Price display + markup-column visibility now come from the shared
// money module (P1-D cleanup 2): lineTotal() and categoryBearsMarkup().

/* ============================================================
 * Shared input styling — desktop cell + mobile inline-edit
 * ============================================================ */

function cellInputClasses(invalid: boolean): string {
  const base =
    'w-full rounded-md border bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500'
  return invalid
    ? `${base} border-rose-400 focus:border-rose-500 focus:ring-rose-200`
    : `${base} border-gray-300 focus:border-brand-navy focus:ring-brand-navy/20`
}

function LabeledMobileField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  )
}
