import {
  ChevronLeft,
  ChevronRight,
  Minus,
  PanelRightClose,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { distanceBetweenPoints } from '@/lib/measureCoords'
import type {
  Measurement,
  PageScale,
  Point,
  WorkArea,
} from '@/lib/types'
import { parseLinePoints } from '@/lib/measureCoords'

/**
 * Right-column sidebar for the measure view. Houses:
 *   - Scale status (moved here from sub-header in Phase 4)
 *   - Default work area picker
 *   - Measurements list for the current page
 *   - Selected measurement detail + delete action
 *
 * Collapsible — when collapsed, shrinks to a thin strip with an expand
 * button so the user can reclaim canvas width. The parent (MeasureView)
 * owns collapsed state so the canvas's ResizeObserver re-runs when the
 * sidebar toggles.
 *
 * The measurements list is parent-filtered to the current page; this
 * component just renders + groups what it's given.
 */

interface MeasureSidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  pageNumber: number
  pageScale: PageScale | null
  workAreas: readonly WorkArea[]
  defaultWorkAreaId: string | null
  onDefaultWorkAreaChange: (id: string | null) => void
  /** Pre-filtered to the current page by the parent. */
  measurements: readonly Measurement[]
  selectedId: string | null
  onSelectMeasurement: (id: string | null) => void
  onDeleteMeasurement: (id: string) => void
}

export function MeasureSidebar({
  collapsed,
  onToggleCollapsed,
  pageNumber,
  pageScale,
  workAreas,
  defaultWorkAreaId,
  onDefaultWorkAreaChange,
  measurements,
  selectedId,
  onSelectMeasurement,
  onDeleteMeasurement,
}: MeasureSidebarProps) {
  // ─── Collapsed strip ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        aria-label="Measure sidebar (collapsed)"
        className="flex w-10 shrink-0 flex-col items-center border-l border-brand-border bg-white py-3"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-navy"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  // ─── Expanded panel ──────────────────────────────────────────────

  // Lookup table so list rows can show their work area's name without
  // a per-row find().
  const workAreaById = new Map(workAreas.map((wa) => [wa.id, wa]))

  // Phase 4 only ships line measurements. Filter explicitly so the
  // list doesn't break if a Phase 5+ tool lands data we don't render.
  const lineMeasurements = measurements.filter((m) => m.tool_type === 'line')

  const selectedMeasurement =
    selectedId !== null
      ? measurements.find((m) => m.id === selectedId) ?? null
      : null

  return (
    <aside
      aria-label="Measure sidebar"
      className="flex w-[270px] shrink-0 flex-col overflow-y-auto border-l border-brand-border bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2.5">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-text-muted">
          Page {pageNumber}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-navy"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Scale status */}
      <section className="border-b border-brand-border px-3 py-3">
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-text-muted">
          Scale
        </div>
        {pageScale ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tabular-nums text-brand-navy">
              {pageScale.real_world_distance}
            </span>
            <span className="text-sm font-semibold text-brand-text">
              {pageScale.real_world_unit}
            </span>
          </div>
        ) : (
          <div className="inline-block rounded-md border border-brand-gold/40 bg-brand-gold-pale px-2 py-1 text-xs font-semibold text-brand-gold-dark">
            Not calibrated
          </div>
        )}
      </section>

      {/* Default work area picker */}
      <section className="border-b border-brand-border px-3 py-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-brand-text-muted">
            Default work area
          </span>
          {workAreas.length === 0 ? (
            <p className="text-xs text-brand-text-muted">
              No work areas yet. Add them in the project's Work Areas
              tab — new measurements will fall back to "No work area"
              until then.
            </p>
          ) : (
            <select
              value={defaultWorkAreaId ?? ''}
              onChange={(e) =>
                onDefaultWorkAreaChange(e.target.value === '' ? null : e.target.value)
              }
              className="w-full rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            >
              <option value="">No work area</option>
              {workAreas.map((wa) => (
                <option key={wa.id} value={wa.id}>
                  {wa.name}
                </option>
              ))}
            </select>
          )}
        </label>
      </section>

      {/* Measurements list */}
      <section className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-brand-border px-3 py-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-brand-text-muted">
            Measurements
          </div>
          <div className="text-xs tabular-nums text-brand-text-muted">
            {lineMeasurements.length}
          </div>
        </div>

        {lineMeasurements.length === 0 ? (
          <div className="px-3 py-4 text-xs text-brand-text-muted">
            No measurements on this page yet. Pick the Line tool and
            click two points to start.
          </div>
        ) : (
          <ul>
            {lineMeasurements.map((m) => {
              const distance = realWorldDistanceFor(m, pageScale)
              const wa = m.work_area_id
                ? workAreaById.get(m.work_area_id) ?? null
                : null
              const isSelected = m.id === selectedId
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectMeasurement(isSelected ? null : m.id)
                    }
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-brand-border/60 px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-brand-gold-pale'
                        : 'hover:bg-brand-surface'
                    )}
                  >
                    <Minus
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        isSelected ? 'text-brand-gold-dark' : 'text-brand-text-muted'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'truncate text-sm font-semibold tabular-nums',
                          isSelected ? 'text-brand-gold-dark' : 'text-brand-text'
                        )}
                      >
                        {distance ?? '—'}
                      </div>
                      <div className="truncate text-[11px] text-brand-text-muted">
                        {wa?.name ?? 'No work area'}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Selected detail */}
      {selectedMeasurement && (
        <section className="border-t border-brand-border bg-brand-surface px-3 py-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-text-muted">
            Selected
          </div>
          <div className="mb-1 text-lg font-bold tabular-nums text-brand-text">
            {realWorldDistanceFor(selectedMeasurement, pageScale) ?? '—'}
          </div>
          <div className="mb-3 text-xs text-brand-text-muted">
            {selectedMeasurement.work_area_id
              ? workAreaById.get(selectedMeasurement.work_area_id)?.name ??
                'Unknown work area'
              : 'No work area'}
          </div>
          <button
            type="button"
            onClick={() => onDeleteMeasurement(selectedMeasurement.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete measurement
          </button>
        </section>
      )}
    </aside>
  )
}

/**
 * Compute the display string for a measurement's real-world distance.
 * Returns null when the data isn't ready yet (no scale, malformed
 * points). Decimal format only — Phase 7 may add architectural format.
 *
 * IMPORTANT: this reads from the LIVE pageScale, never from
 * measurement.calculated_value. If the page is recalibrated, labels
 * update immediately because we recompute every render.
 */
function realWorldDistanceFor(
  m: Measurement,
  pageScale: PageScale | null
): string | null {
  if (!pageScale) return null
  if (m.tool_type !== 'line') return null
  const pts = parseLinePoints(m.points)
  if (!pts) return null
  const pdfDistance = distanceBetweenPoints(pts[0] as Point, pts[1] as Point)
  const realWorld = pdfDistance * pageScale.scale_factor
  return `${realWorld.toFixed(1)} ${pageScale.real_world_unit}`
}

// Silence "unused" for icons we may want during collapse animation later.
void ChevronRight
