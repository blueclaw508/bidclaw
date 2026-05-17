import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RealWorldUnit } from '@/lib/types'

/**
 * Floating calibration form. Replaces an earlier modal version — the
 * modal's backdrop blur was blocking the contractor's view of the
 * plan's existing scale annotations (e.g. the "SCALE: 3/32\" = 1'0\""
 * in title blocks) which they need to reference while entering the
 * real-world distance.
 *
 * Renders as a non-modal panel pinned to the top-right of the canvas
 * area. Plan stays fully visible underneath. Clicks outside the panel
 * do NOT dismiss — only Cancel / X / Esc do (Esc handled by parent).
 */
interface CalibrationPanelProps {
  open: boolean
  onClose: () => void
  /**
   * Called when the user submits a valid distance + unit. Parent runs
   * the DB write and clears draft on success. While the promise is
   * pending, the panel shows a spinner and disables inputs.
   */
  onSubmit: (distance: number, unit: RealWorldUnit) => Promise<void> | void
  /**
   * PDF-page-unit distance between the two clicked points. Shown as
   * info so the contractor knows what they're scaling.
   */
  pdfDistance: number
}

// CHECK constraint values from 0002_page_scales.sql — keep in sync.
const UNIT_OPTIONS: readonly { value: RealWorldUnit; label: string }[] = [
  { value: 'ft', label: 'feet (ft)' },
  { value: 'in', label: 'inches (in)' },
  { value: 'yd', label: 'yards (yd)' },
  { value: 'm',  label: 'meters (m)' },
  { value: 'cm', label: 'centimeters (cm)' },
]

export function CalibrationPanel({
  open,
  onClose,
  onSubmit,
  pdfDistance,
}: CalibrationPanelProps) {
  const [distanceText, setDistanceText] = useState('')
  const [unit, setUnit] = useState<RealWorldUnit>('ft')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset every time the panel opens fresh (new calibration draft).
  useEffect(() => {
    if (open) {
      setDistanceText('')
      setUnit('ft')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const distance = parseFloat(distanceText)
    if (!Number.isFinite(distance) || distance <= 0) {
      setError('Enter a distance greater than zero.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(distance, unit)
      // Parent clears draft on success — panel auto-closes via the
      // `open` prop. Errors keep the panel open with inputs preserved.
    } catch (err) {
      setError((err as Error).message || 'Save failed. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div
      // Pinned to top-right of the canvas area (sibling of the toolbar,
      // mirrors it across the canvas). Same z-10 as the toolbar so they
      // share the floating-UI plane.
      className="absolute right-5 top-5 z-10 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-brand-border bg-white shadow-lg"
      role="dialog"
      aria-label="Calibrate this page"
    >
      <header className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-brand-text">Calibrate this page</h2>
          <p className="mt-0.5 text-xs text-brand-text-muted">
            Real-world distance between your two clicked points.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Cancel calibration"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-text disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
        <div className="rounded-md bg-brand-surface px-3 py-2 text-xs text-brand-text-muted">
          PDF distance:{' '}
          <span className="font-semibold tabular-nums text-brand-text">
            {pdfDistance.toFixed(2)}
          </span>{' '}
          PDF units
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            Real-world distance
          </span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            autoFocus
            required
            value={distanceText}
            onChange={(e) => setDistanceText(e.target.value)}
            disabled={submitting}
            placeholder="e.g. 10"
            className={inputClasses}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            Unit
          </span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as RealWorldUnit)}
            disabled={submitting}
            className={inputClasses}
          >
            {UNIT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || distanceText === ''}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
              submitting && 'cursor-wait'
            )}
          >
            {submitting ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-brand-surface'
