import { useEffect, useState } from 'react'
import { Modal } from '@/components/Modal'
import { cn } from '@/lib/utils'

/**
 * Post-Finish label step for an area-tool session. Modal with backdrop
 * (same pattern as CountLabelModal) — pure text entry, no need to see
 * plan markers underneath.
 *
 * Header shows the computed real-world area in the page's current
 * units so the contractor sees what they're labeling.
 */
interface AreaLabelModalProps {
  open: boolean
  /** Computed real-world area (already × scale_factor²). Pre-formatted. */
  areaDisplay: string
  onSubmit: (label: string | null) => Promise<void> | void
  onClose: () => void
}

export function AreaLabelModal({
  open,
  areaDisplay,
  onSubmit,
  onClose,
}: AreaLabelModalProps) {
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLabel('')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const trimmed = label.trim()
      await onSubmit(trimmed === '' ? null : trimmed)
    } catch (err) {
      setError((err as Error).message || 'Save failed. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={`Area: ${areaDisplay}`}
      description="Label this measurement (optional). Helpful when you have multiple areas on the same page."
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            Label
          </span>
          <input
            type="text"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
            placeholder="e.g. Front lawn, Pool deck, Driveway"
            maxLength={200}
            className="w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-brand-surface"
          />
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
            className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
              submitting && 'cursor-wait'
            )}
          >
            {submitting ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Saving…
              </>
            ) : (
              'Save area'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
