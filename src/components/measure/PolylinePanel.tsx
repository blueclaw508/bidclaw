import { cn } from '@/lib/utils'

/**
 * Floating panel shown during an active freehand polyline session.
 * Same top-right placement + non-modal pattern as the calibration,
 * count, and area panels.
 *
 * Two completion paths:
 *   - Finish button       → open polyline (perimeter only)
 *   - Click first vertex  → closed polyline (perimeter + area)
 *     (handled in MeasureView's pointer-down close detection, not here)
 */
interface PolylinePanelProps {
  open: boolean
  vertexCount: number
  onFinish: () => void
  onCancel: () => void
}

/** Min vertex count for an OPEN polyline (just need a single edge). */
const MIN_OPEN_VERTICES = 2

export function PolylinePanel({
  open,
  vertexCount,
  onFinish,
  onCancel,
}: PolylinePanelProps) {
  if (!open) return null
  const canFinish = vertexCount >= MIN_OPEN_VERTICES

  return (
    <div
      role="dialog"
      aria-label="Polyline session"
      className="absolute right-5 top-5 z-10 w-72 max-w-[calc(100vw-2.5rem)] rounded-xl border border-brand-border bg-white shadow-lg"
    >
      <div className="border-b border-brand-border px-4 py-3">
        <h2 className="text-sm font-bold text-brand-text">Freehand polyline</h2>
        <p className="mt-0.5 text-xs text-brand-text-muted">
          Click to add points. Click the first point again to close, or
          Finish for an open polyline.
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
              : `Add at least ${MIN_OPEN_VERTICES} vertices to finish`
          }
          className={cn(
            'rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
            !canFinish && 'cursor-not-allowed'
          )}
        >
          Finish open
        </button>
      </div>
    </div>
  )
}
