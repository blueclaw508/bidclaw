import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, X } from 'lucide-react'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { BlurSaveInput } from '@/components/InlineEdit'
import {
  categoryBearsMarkup,
  effectiveMarkupPercent,
  estimateLineBase,
  estimateLineTotal,
  formatUSD,
  liveMarkupPercent,
  type LiveMarkupSettings,
} from '@/lib/money'
import type { WorkAreaLine } from '@/lib/types'

/**
 * One LIVE estimate line row (estimate-first rework, R2). QC-faithful:
 *
 *   name | Qty | Cost (base) | Markup pill (live, display-only) | Price | 🗑
 *
 * INSTANT SAVE — every commit writes immediately via the parent's
 * mutators (optimistic local + DB). No dirty state, no Save bar.
 *
 * Price column semantics (QC's isAmountOverridden):
 *   • displays estimateLineTotal (override ?? computed)
 *   • editing it sets price_override → amber styling + a clear (×)
 *     affordance; qty/cost edits do NOT recompute an overridden price
 *   • clearing the override returns to computed pricing
 */

interface WorkAreaLineRowProps {
  line: WorkAreaLine
  settings: LiveMarkupSettings
  onPatch: (patch: Partial<WorkAreaLine>) => void
  onDelete: () => void
}

export function WorkAreaLineRow({
  line,
  settings,
  onPatch,
  onDelete,
}: WorkAreaLineRowProps) {
  const bearsMarkup = categoryBearsMarkup(line.category)
  const globalMarkup = liveMarkupPercent(line.category, settings)
  const markupPct = effectiveMarkupPercent(line, settings)
  const markupOverridden = line.markup_override !== null
  const price = estimateLineTotal(line, settings)
  const base = estimateLineBase(line)
  const overridden = line.price_override !== null

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="px-3 py-2 hover:bg-white/70 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Drag handle — reorder within this category */}
        <button
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Item name — blur-save inline edit */}
        <div className="min-w-[140px] flex-[2]">
          <BlurSaveInput
            value={line.label}
            onSave={(v) => onPatch({ label: v })}
            placeholder="Item name…"
            className="w-full rounded border-b border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-gray-900 outline-none transition-all placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-navy focus:bg-white"
          />
        </div>

        {/* Qty */}
        <div className="w-16 shrink-0 sm:w-20">
          <DecimalInput
            value={line.quantity}
            onCommit={(n) => onPatch({ quantity: n ?? 0 })}
            placeholder="0"
            ariaLabel="Quantity"
            className={numInputClasses}
          />
        </div>

        {/* Cost — BASE cost per unit */}
        <div className="relative w-20 shrink-0 sm:w-24">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            $
          </span>
          <DecimalInput
            value={line.unit_cost}
            onCommit={(n) => onPatch({ unit_cost: n ?? 0 })}
            placeholder="0.00"
            ariaLabel="Base cost per unit"
            className={`${numInputClasses} pl-4`}
          />
        </div>

        {/* Markup — editable per line; blank/× returns to your live markup */}
        <div className="w-16 shrink-0 sm:w-20">
          {bearsMarkup ? (
            <div className="relative">
              <DecimalInput
                value={markupPct}
                onCommit={(n) => {
                  if (n === null) {
                    onPatch({ markup_override: null })
                  } else if (Math.abs(n - globalMarkup) > 1e-9 || markupOverridden) {
                    onPatch({ markup_override: n })
                  }
                }}
                placeholder="0"
                ariaLabel="Markup percent (edit to override this line)"
                title={
                  markupOverridden
                    ? 'Markup overridden for this line — click × to return to your live markup'
                    : 'Edit to set a custom markup for this line'
                }
                className={`${numInputClasses} pr-4 ${
                  markupOverridden
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'text-gray-700'
                }`}
              />
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                %
              </span>
              {markupOverridden && (
                <button
                  type="button"
                  onClick={() => onPatch({ markup_override: null })}
                  aria-label="Clear markup override"
                  title="Clear override — back to your live markup"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm hover:bg-amber-600"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ) : (
            <span className="block text-right text-xs text-gray-300">—</span>
          )}
        </div>

        {/* Price — editable; override → amber + clear affordance */}
        <div className="relative w-24 shrink-0 sm:w-28">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            $
          </span>
          <DecimalInput
            value={price}
            onCommit={(n) => {
              // Committing the computed value is a no-op; anything else
              // sets the override. null (cleared field) clears override.
              if (n === null) {
                onPatch({ price_override: null })
              } else if (Math.abs(n - price) > 1e-9 || overridden) {
                onPatch({ price_override: n })
              }
            }}
            placeholder="0.00"
            ariaLabel="Line price (edit to override)"
            title={
              overridden
                ? 'Price manually overridden — click × to return to computed pricing'
                : 'Edit to override the computed price'
            }
            className={`${numInputClasses} pl-4 font-semibold ${
              overridden
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'text-gray-900'
            }`}
          />
          {overridden && (
            <button
              type="button"
              onClick={() => onPatch({ price_override: null })}
              aria-label="Clear price override"
              title="Clear override — back to computed price"
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm hover:bg-amber-600"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>

        {/* Delete — instant, QC model */}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete line"
          className="shrink-0 p-0.5 text-gray-300 transition-colors hover:text-rose-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* QC-style breakdown subtitle for markup-bearing lines */}
      {bearsMarkup && Number(line.quantity) > 0 && Number(line.unit_cost) > 0 && (
        <div className="ml-1 mt-1 text-xs text-gray-400">
          {Number(line.quantity)} × {formatUSD(Number(line.unit_cost))} cost +{' '}
          {markupPct.toFixed(2)}%{markupOverridden && ' (custom)'} ={' '}
          {formatUSD(base * (1 + markupPct / 100))}
          {overridden && (
            <span className="ml-1.5 font-medium text-amber-600">
              (overridden to {formatUSD(Number(line.price_override))})
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const numInputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm outline-none transition-colors focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'
