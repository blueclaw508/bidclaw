import { Loader2 } from 'lucide-react'

/**
 * Suspense fallback for lazy-loaded routes. Branded spinner on the
 * surface background so the layout doesn't visually jump while a
 * route chunk is in flight.
 */
export function RouteLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-brand-surface">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
        <p className="text-xs font-medium text-brand-text-muted">Loading…</p>
      </div>
    </div>
  )
}
