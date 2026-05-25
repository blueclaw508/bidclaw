import { cn } from '@/lib/utils'

/**
 * Floating panel shown during an active count session. Same top-right
 * positioning + non-modal pattern as CalibrationPanel — the contractor
 * needs to see the plan + their dropped markers while deciding when
 * to finish.
 *
 * The panel itself is dumb display + two buttons. Parent owns the
 * count state, marker rendering, and the click handler that grows
 * the marker array.
 */
interface CountPanelProps {
  open: boolean
  count: number
  onFinish: () => void
  onCancel: () => void
}

export function CountPanel({ open, count, onFinish, onCancel }: CountPanelProps) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Count session"
      className="absolute right-5 top-5 z-10 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-brand-border bg-white shadow-lg"
    >
      <div className="border-b border-brand-border px-4 py-3">
        <h2 className="text-sm font-bold text-brand-text">Count session</h2>
        <p className="mt-0.5 text-xs text-brand-text-muted">
          Click each item on the plan. Press Finish when you're done.
        </p>
      </div>

      <div className="flex items-baseline justify-center gap-1.5 px-4 py-4">
        <span className="text-3xl font-bold tabular-nums text-brand-navy">
          {count}
        </span>
        <span className="text-sm font-semibold text-brand-text-muted">
          {count === 1 ? 'marker' : 'markers'}
        </span>
      </div>

      <div className="flex justify-end gap-2 border-t border-brand-border px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={count === 0}
          className={cn(
            'rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
            count === 0 && 'cursor-not-allowed'
          )}
        >
          Finish
        </button>
      </div>
    </div>
  )
}
