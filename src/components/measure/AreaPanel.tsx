import { cn } from '@/lib/utils'

/**
 * Floating panel shown during an active area-tool session. Same
 * top-right placement + non-modal pattern as CalibrationPanel and
 * CountPanel — contractor needs to see the plan + their growing
 * polygon while deciding when to finish.
 *
 * Finish is gated on ≥3 vertices — 2 vertices is a line, not an area.
 */
interface AreaPanelProps {
  open: boolean
  vertexCount: number
  onFinish: () => void
  onCancel: () => void
}

/** Minimum vertex count for a valid polygon. Below this Finish stays disabled. */
const MIN_VERTICES = 3

export function AreaPanel({ open, vertexCount, onFinish, onCancel }: AreaPanelProps) {
  if (!open) return null
  const canFinish = vertexCount >= MIN_VERTICES

  return (
    <div
      role="dialog"
      aria-label="Area session"
      className="absolute right-5 top-5 z-10 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-brand-border bg-white shadow-lg"
    >
      <div className="border-b border-brand-border px-4 py-3">
        <h2 className="text-sm font-bold text-brand-text">Area session</h2>
        <p className="mt-0.5 text-xs text-brand-text-muted">
          Click each corner of the shape. {MIN_VERTICES}+ vertices required.
        </p>
      </div>

      <div className="flex items-baseline justify-center gap-1.5 px-4 py-4">
        <span className="text-3xl font-bold tabular-nums text-brand-navy">
          {vertexCount}
        </span>
        <span className="text-sm font-semibold text-brand-text-muted">
          {vertexCount === 1 ? 'vertex' : 'vertices'}
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
          disabled={!canFinish}
          title={
            canFinish
              ? undefined
              : `Add at least ${MIN_VERTICES} vertices to finish`
          }
          className={cn(
            'rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
            !canFinish && 'cursor-not-allowed'
          )}
        >
          Finish
        </button>
      </div>
    </div>
  )
}
