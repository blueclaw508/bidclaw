import {
  ChevronLeft,
  ChevronRight,
  Hash,
  Hexagon,
  Minus,
  PanelRightClose,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  distanceBetweenPoints,
  parseAreaPoints,
  parseCountPoints,
  parseLinePoints,
  polygonArea,
  realWorldArea,
} from '@/lib/measureCoords'
import type {
  Measurement,
  MeasurementToolType,
  PageScale,
  Point,
  WorkArea,
} from '@/lib/types'

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

  // Phase 5 — group measurements by tool_type. GROUP_ORDER is an
  // explicit constant so the rendering order is deterministic + the
  // pattern extends cleanly when area / freehand land. Empty groups
  // don't render their header.
  const grouped: Record<MeasurementToolType, Measurement[]> = {
    line: [],
    count: [],
    area: [],
    freehand_polyline: [],
    freehand_drag: [],
  }
  for (const m of measurements) {
    grouped[m.tool_type].push(m)
  }
  const totalRendered =
    grouped.line.length +
    grouped.count.length +
    grouped.area.length /* + freehand later */

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

      {/* Measurements list — grouped by tool type. Empty groups
          skip their headers; entirely-empty page shows the empty-state
          hint. */}
      <section className="flex-1 overflow-y-auto">
        {totalRendered === 0 ? (
          <div className="px-3 py-4 text-xs text-brand-text-muted">
            No measurements on this page yet. Pick the Line or Count tool
            and start clicking.
          </div>
        ) : (
          <>
            {grouped.line.length > 0 && (
              <MeasurementGroup
                heading="Lines"
                count={grouped.line.length}
                items={grouped.line}
                selectedId={selectedId}
                onSelect={onSelectMeasurement}
                renderRow={(m, isSelected) => (
                  <LineRow
                    m={m}
                    isSelected={isSelected}
                    workArea={
                      m.work_area_id
                        ? workAreaById.get(m.work_area_id) ?? null
                        : null
                    }
                    pageScale={pageScale}
                  />
                )}
              />
            )}
            {grouped.count.length > 0 && (
              <MeasurementGroup
                heading="Counts"
                count={grouped.count.length}
                items={grouped.count}
                selectedId={selectedId}
                onSelect={onSelectMeasurement}
                renderRow={(m, isSelected) => (
                  <CountRow
                    m={m}
                    isSelected={isSelected}
                    workArea={
                      m.work_area_id
                        ? workAreaById.get(m.work_area_id) ?? null
                        : null
                    }
                  />
                )}
              />
            )}
            {grouped.area.length > 0 && (
              <MeasurementGroup
                heading="Areas"
                count={grouped.area.length}
                items={grouped.area}
                selectedId={selectedId}
                onSelect={onSelectMeasurement}
                renderRow={(m, isSelected) => (
                  <AreaRow
                    m={m}
                    isSelected={isSelected}
                    workArea={
                      m.work_area_id
                        ? workAreaById.get(m.work_area_id) ?? null
                        : null
                    }
                    pageScale={pageScale}
                  />
                )}
              />
            )}
          </>
        )}
      </section>

      {/* Selected detail */}
      {selectedMeasurement && (
        <section className="border-t border-brand-border bg-brand-surface px-3 py-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-text-muted">
            Selected
          </div>
          <div className="mb-1 text-lg font-bold tabular-nums text-brand-text">
            {primaryDisplayFor(selectedMeasurement, pageScale)}
          </div>
          {selectedMeasurement.tool_type === 'count' &&
            selectedMeasurement.label && (
              <div className="mb-1 text-sm font-semibold text-brand-text">
                {selectedMeasurement.label}
              </div>
            )}
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

// ──────────────────────────────────────────────────────────────────────
// Group + per-type row subcomponents.
// ──────────────────────────────────────────────────────────────────────

interface MeasurementGroupProps {
  heading: string
  count: number
  items: readonly Measurement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  renderRow: (m: Measurement, isSelected: boolean) => React.ReactNode
}

function MeasurementGroup({
  heading,
  count,
  items,
  selectedId,
  onSelect,
  renderRow,
}: MeasurementGroupProps) {
  return (
    <div>
      <div className="flex items-center justify-between border-y border-brand-border bg-brand-surface/60 px-3 py-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">
          {heading}
        </div>
        <div className="text-[11px] tabular-nums text-brand-text-muted">
          ({count})
        </div>
      </div>
      <ul>
        {items.map((m) => {
          const isSelected = m.id === selectedId
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(isSelected ? null : m.id)}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-brand-border/60 px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'bg-brand-gold-pale'
                    : 'hover:bg-brand-surface'
                )}
              >
                {renderRow(m, isSelected)}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LineRow({
  m,
  isSelected,
  workArea,
  pageScale,
}: {
  m: Measurement
  isSelected: boolean
  workArea: WorkArea | null
  pageScale: PageScale | null
}) {
  const distance = realWorldDistanceFor(m, pageScale)
  return (
    <>
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
          {workArea?.name ?? 'No work area'}
        </div>
      </div>
    </>
  )
}

function CountRow({
  m,
  isSelected,
  workArea,
}: {
  m: Measurement
  isSelected: boolean
  workArea: WorkArea | null
}) {
  const pts = parseCountPoints(m.points)
  const n = pts?.length ?? 0
  return (
    <>
      <Hash
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
          {n}{' '}
          <span className="text-[11px] font-normal text-brand-text-muted">
            {n === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="truncate text-[11px] text-brand-text-muted">
          {m.label ? `${m.label} · ` : ''}
          {workArea?.name ?? 'No work area'}
        </div>
      </div>
    </>
  )
}

function AreaRow({
  m,
  isSelected,
  workArea,
  pageScale,
}: {
  m: Measurement
  isSelected: boolean
  workArea: WorkArea | null
  pageScale: PageScale | null
}) {
  const display = realWorldAreaFor(m, pageScale)
  return (
    <>
      <Hexagon
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
          {display ?? '—'}
        </div>
        <div className="truncate text-[11px] text-brand-text-muted">
          {m.label ? `${m.label} · ` : ''}
          {workArea?.name ?? 'No work area'}
        </div>
      </div>
    </>
  )
}

/**
 * Primary display string for the Selected detail panel. Tool-aware
 * so line shows distance, count shows N items, area shows sq-units.
 */
function primaryDisplayFor(
  m: Measurement,
  pageScale: PageScale | null
): string {
  if (m.tool_type === 'count') {
    const pts = parseCountPoints(m.points)
    const n = pts?.length ?? 0
    return `${n} ${n === 1 ? 'item' : 'items'}`
  }
  if (m.tool_type === 'area') {
    return realWorldAreaFor(m, pageScale) ?? '—'
  }
  return realWorldDistanceFor(m, pageScale) ?? '—'
}

/**
 * Live-state recompute for area rows: polygonArea × scale_factor²,
 * formatted with thousand separators. Never reads measurement.
 * calculated_value — same rule as line labels.
 */
function realWorldAreaFor(
  m: Measurement,
  pageScale: PageScale | null
): string | null {
  if (!pageScale) return null
  if (m.tool_type !== 'area') return null
  const verts = parseAreaPoints(m.points)
  if (!verts) return null
  const real = realWorldArea(polygonArea(verts), pageScale.scale_factor)
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(real)
  return `${formatted} sq ${pageScale.real_world_unit}`
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
