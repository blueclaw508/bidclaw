import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { getDocument } from '@/lib/pdfjs'
import type { PDFDocumentProxy, RenderTask } from '@/lib/pdfjs'
import { AreaLabelModal } from '@/components/measure/AreaLabelModal'
import { AreaPanel } from '@/components/measure/AreaPanel'
import { CalibrationPanel } from '@/components/measure/CalibrationPanel'
import { CountLabelModal } from '@/components/measure/CountLabelModal'
import { CountPanel } from '@/components/measure/CountPanel'
import { MeasureSidebar } from '@/components/measure/MeasureSidebar'
import { MeasureToolbar } from '@/components/measure/MeasureToolbar'
import { MobileWarning } from '@/components/measure/MobileWarning'
import { PolylineLabelModal } from '@/components/measure/PolylineLabelModal'
import { PolylinePanel } from '@/components/measure/PolylinePanel'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  computeScaleFactor,
  distanceBetweenPoints,
  distancePointToSegment,
  getMeasurementsForPage,
  midpoint,
  parseAreaPoints,
  parseCountPoints,
  parseLinePoints,
  parsePolylinePoints,
  pdfPageToCanvas,
  pointInCircle,
  pointInPolygon,
  polygonArea,
  polylinePerimeter,
  realWorldArea,
  screenToPdfPage,
} from '@/lib/measureCoords'
import { cn } from '@/lib/utils'
import type {
  Measurement,
  MeasureToolMode,
  PageScale,
  Point,
  ProjectFile,
  RealWorldUnit,
  RenderInfo,
  WorkArea,
} from '@/lib/types'

/**
 * Manual measuring tool.
 *
 * Phase 1 — PDF rendering foundation (shipped, commit 33afa08).
 * Phase 2 — overlay canvas + coordinate system + selection.
 * Phase 3+ — calibration, tools, polish.
 *
 * Lives inside AppShell at /app/projects/:projectId/measure/:fileId.
 *
 * Two-canvas stack: the PDF canvas (underneath, pointer-events: none) is
 * a passive raster; the overlay canvas (on top, pointer-events: auto)
 * carries measurements + interaction. Both canvases are sized identically
 * in both backing-store and CSS dimensions via the SAME RenderInfo
 * snapshot, so they can't drift.
 */

type LoadState = 'fetching' | 'opening' | 'rendering' | 'ready' | 'error'

// Brand-kit-bcg colors. Canvas-rendered geometry can't use Tailwind
// classes, so we inline the hex values here.
const BRAND_NAVY = '#0032A1'
const BRAND_GOLD = '#C9A84C'

/** Hit threshold for selecting a measurement, in CSS px. */
const HIT_THRESHOLD = 6

/**
 * Radius of the small dot rendered at each clicked calibration point
 * (CSS px, drawn in PDF-canvas backing-store px scaled by dpr).
 */
const CALIBRATION_DOT_RADIUS = 4

/**
 * Phase 5 base tools — always enabled regardless of calibration state.
 * Select + Calibrate are pre-Phase-4. Count is NEW in Phase 5 and is
 * enabled UNCONDITIONALLY (NOT gated on pageScale) because counts are
 * unitless — they don't need a scale to be meaningful. This diverges
 * from line's gating (line needs pageScale to display real-world
 * distance). Don't accidentally add pageScale gating to count.
 *
 * Line is appended dynamically when pageScale exists. Area / Freehand
 * are still disabled (Phase 6 / 7).
 */
const PHASE5_BASE_TOOLS: readonly MeasureToolMode[] = ['select', 'calibrate', 'count']

/**
 * Tooltip shown on the Line tool when it's disabled because the page
 * isn't calibrated yet. Replaces the default "coming in Phase 4" text
 * since line IS shipped — just precondition-blocked.
 */
const LINE_DISABLED_NO_SCALE =
  'Calibrate the page first to enable line measurements'

/** Same precondition tooltip for area (needs scale for sq-unit display). */
const AREA_DISABLED_NO_SCALE =
  'Calibrate the page first to enable area measurements'

/** Same precondition tooltip for freehand polyline. */
const FREEHAND_DISABLED_NO_SCALE =
  'Calibrate the page first to enable freehand measurements'

/** Min viewport width for the measure tool. Below this, MobileWarning replaces everything. */
const MIN_VIEWPORT_WIDTH = 1024

/**
 * Close-detection radius for polyline first-vertex click, in CSS px.
 * Generous enough to be easy to hit, small enough to avoid early-collection
 * false positives (combined with min-vertices + distance-moved gates).
 */
const POLYLINE_CLOSE_RADIUS = 8

/**
 * Minimum distance ANY intermediate polyline vertex must be from the
 * first vertex before close detection activates. Stops a user from
 * accidentally closing within 3 clicks all within 8 CSS px of each
 * other.
 */
const POLYLINE_CLOSE_MIN_TRAVEL = 20

/** Visual radius of count markers, in CSS px. */
const COUNT_MARKER_RADIUS = 9

/** Visual radius of draft-area vertex dots, in CSS px. */
const AREA_DRAFT_DOT_RADIUS = 3

/** Translucent navy fill for unselected saved area polygons. */
const AREA_FILL_UNSELECTED = 'rgba(0, 50, 161, 0.12)'
/** Translucent gold fill for selected saved area polygons. */
const AREA_FILL_SELECTED = 'rgba(201, 168, 76, 0.18)'

/**
 * Format a real-world area value with thousand separators + 1 decimal.
 * "12476.3" → "12,476.3". Used for the label modal header, sidebar
 * row, and on-canvas label.
 */
function formatArea(realWorldArea: number, unit: string): string {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(realWorldArea)
  return `${formatted} sq ${unit}`
}

/**
 * Build a short human description of a measurement for the delete
 * confirm dialog. Type-aware so counts and lines both render
 * sensibly.
 */
function describeMeasurementForDelete(
  m: Measurement,
  pageScale: PageScale | null
): string {
  if (m.tool_type === 'line') {
    if (!pageScale) return '(distance pending calibration)'
    const pts = parseLinePoints(m.points)
    if (!pts) return '(unknown distance)'
    const dist =
      distanceBetweenPoints(pts[0] as Point, pts[1] as Point) *
      pageScale.scale_factor
    return `${dist.toFixed(1)} ${pageScale.real_world_unit}`
  }
  if (m.tool_type === 'count') {
    const pts = parseCountPoints(m.points)
    const n = pts?.length ?? 0
    return m.label ? `${n} — ${m.label}` : `Count of ${n}`
  }
  if (m.tool_type === 'area') {
    if (!pageScale) return '(area pending calibration)'
    const verts = parseAreaPoints(m.points)
    if (!verts) return '(unknown area)'
    const real = realWorldArea(polygonArea(verts), pageScale.scale_factor)
    const display = formatArea(real, pageScale.real_world_unit)
    return m.label ? `${display} (${m.label})` : display
  }
  if (m.tool_type === 'freehand_polyline') {
    if (!pageScale) return '(polyline pending calibration)'
    const parsed = parsePolylinePoints(m.points)
    if (!parsed) return '(unknown polyline)'
    const perim =
      polylinePerimeter(parsed.points, parsed.closed) * pageScale.scale_factor
    const display = `${parsed.closed ? 'Closed' : 'Open'} polyline (${perim.toFixed(1)} ${pageScale.real_world_unit})`
    return m.label ? `${display} (${m.label})` : display
  }
  return '(measurement)'
}

export default function MeasureView() {
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>()
  const navigate = useNavigate()

  const [file, setFile] = useState<ProjectFile | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('fetching')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)

  // Phase 2 additions
  const [tool, setTool] = useState<MeasureToolMode>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  /**
   * Snapshot of the most recent successful PDF render. Single source of
   * truth for overlay sizing + coord transforms. Null until the first
   * page renders successfully; resets when the doc/page/width changes.
   */
  const [renderInfo, setRenderInfo] = useState<RenderInfo | null>(null)

  // Phase 3 additions
  /**
   * Accumulator for the two-click Calibrate flow. 0 points = idle,
   * 1 = first point clicked (draw dot), 2 = both clicked (open modal).
   * Stored in PDF page units, never CSS px — survives resize.
   */
  const [calibrationDraft, setCalibrationDraft] = useState<{
    points: Point[]
  }>({ points: [] })
  /** Calibration row for the current (file, page). Null = not yet calibrated. */
  const [pageScale, setPageScale] = useState<PageScale | null>(null)
  /**
   * Modal visibility. Driven by an effect that watches the draft so we
   * can briefly delay the modal after the second click — that delay
   * lets the overlay paint the second dot + dashed line first, giving
   * the user visible feedback for their click before the modal covers
   * the canvas.
   */
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)

  // Phase 4 additions
  /** Right-column sidebar visibility. Default expanded. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  /** Work areas for the parent project (NOT filtered by status — no archive
   *  flag exists yet on work_areas; flag in handoff so future phases don't
   *  assume one). */
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  /**
   * Default work area applied to newly-committed line measurements.
   * Null = "No work area" — preserved as a valid choice.
   */
  const [defaultWorkAreaId, setDefaultWorkAreaId] = useState<string | null>(null)
  /**
   * Line tool draft (same pattern as calibrationDraft). 0 = idle,
   * 1 = first point clicked (draw dot), 2 = both clicked (commit on
   * the same render cycle, then reset). Points in PDF page units.
   */
  const [lineDraft, setLineDraft] = useState<{ points: Point[] }>({
    points: [],
  })
  /** Measurement queued for delete-confirm dialog. Null = no dialog. */
  const [deleteTarget, setDeleteTarget] = useState<Measurement | null>(null)

  // Phase 5 additions — count tool session.
  /**
   * Count session draft. Two-phase state machine:
   *   - 'collecting'     — CountPanel visible, every canvas click
   *                        appends a marker.
   *   - 'awaiting_label' — markers locked, CountLabelModal visible,
   *                        canvas clicks no-op until save/cancel.
   *   - null             — no active session (default).
   * Points in PDF page units. Marker numbering = index + 1.
   */
  const [countDraft, setCountDraft] = useState<{
    points: Point[]
    status: 'collecting' | 'awaiting_label'
  } | null>(null)

  // Phase 6 additions — area tool session.
  /**
   * Area session draft. Same two-phase shape as countDraft but
   * vertices form a polygon (order matters; closed implicitly).
   * Minimum 3 vertices required to Finish.
   */
  const [areaDraft, setAreaDraft] = useState<{
    points: Point[]
    status: 'collecting' | 'awaiting_label'
  } | null>(null)

  // Phase 7 additions — freehand polyline session, mobile detection,
  // rubber-band preview, keyboard shortcuts.
  /**
   * Polyline session draft. Adds a `closed` flag relative to area/count
   * because polylines can complete two ways:
   *   - Finish button       → closed=false, open polyline
   *   - Click first vertex  → closed=true, points has first duplicated
   *                           at the end (storage encoding for closed)
   */
  const [polylineDraft, setPolylineDraft] = useState<{
    points: Point[]
    status: 'collecting' | 'awaiting_label'
    closed: boolean
  } | null>(null)

  /** True when viewport width < MIN_VIEWPORT_WIDTH — MobileWarning replaces layout. */
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MIN_VIEWPORT_WIDTH
  )

  /**
   * Current pointer position in PDF page units, used ONLY for
   * rubber-band rendering. Lives in a ref so pointer-move handlers
   * don't trigger React re-renders — re-renders are coordinated by
   * the rubberBandTick state, bumped from inside a RAF.
   */
  const cursorPdfRef = useRef<Point | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [rubberBandTick, setRubberBandTick] = useState(0)

  const measureRef = useRef<HTMLDivElement | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const backTo = projectId ? `/app/projects/${projectId}` : '/app/projects'

  // ──────────────────────────────────────────────────────────────────
  // 1. Fetch file row → validate → download bytes → parse with pdfjs.
  //    Upfront download means the 60-second signed URL doesn't have to
  //    survive a long edit session — pdfjs holds the bytes in worker
  //    memory once parsed.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !fileId) return

    let cancelled = false
    let docToDestroy: PDFDocumentProxy | null = null

    async function load() {
      setLoadState('fetching')
      setErrorMessage(null)
      setDoc(null)
      setPageCount(0)
      setPageNumber(1)
      setFile(null)
      setRenderInfo(null)
      setSelectedId(null)
      setCalibrationDraft({ points: [] })
      setPageScale(null)
      setLineDraft({ points: [] })
      setDeleteTarget(null)
      setCountDraft(null)
      setAreaDraft(null)
      setPolylineDraft(null)

      // RLS returns zero rows for files this user can't see, which looks
      // identical to "doesn't exist". That's the right UX — don't leak
      // whether a fileId is real for some other user.
      const { data: row, error } = await supabase
        .from('project_files')
        .select('*')
        .eq('id', fileId)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setErrorMessage(`Couldn't load this file: ${error.message}`)
        setLoadState('error')
        return
      }
      if (!row) {
        setErrorMessage('File not found or not accessible.')
        setLoadState('error')
        return
      }
      if (row.project_id !== projectId) {
        setErrorMessage('File not found or not accessible.')
        setLoadState('error')
        return
      }
      if (row.mime_type !== 'application/pdf') {
        setErrorMessage(
          "This file isn't a PDF. The measure tool only supports PDFs in this version."
        )
        setLoadState('error')
        return
      }
      setFile(row as ProjectFile)

      setLoadState('opening')
      const { data: signed, error: signErr } = await supabase.storage
        .from('project-files')
        .createSignedUrl(row.storage_path, 60)
      if (cancelled) return
      if (signErr || !signed?.signedUrl) {
        setErrorMessage(
          `Couldn't open this file: ${signErr?.message ?? 'no signed URL'}`
        )
        setLoadState('error')
        return
      }

      let buffer: ArrayBuffer
      try {
        const res = await fetch(signed.signedUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        buffer = await res.arrayBuffer()
      } catch (err) {
        if (cancelled) return
        setErrorMessage(`Couldn't download this file: ${(err as Error).message}`)
        setLoadState('error')
        return
      }
      if (cancelled) return

      try {
        const loaded = await getDocument({ data: buffer }).promise
        if (cancelled) {
          await loaded.destroy()
          return
        }
        docToDestroy = loaded
        setDoc(loaded)
        setPageCount(loaded.numPages)
        setPageNumber(1)
        setLoadState('rendering')
      } catch (err) {
        if (cancelled) return
        setErrorMessage(`Couldn't parse this PDF: ${(err as Error).message}`)
        setLoadState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (docToDestroy) {
        void docToDestroy.destroy()
      }
    }
  }, [projectId, fileId])

  // ──────────────────────────────────────────────────────────────────
  // 2. Load measurements for this source file. Non-critical — toast on
  //    error but don't tear down the view. Filter by pdf_page_number
  //    happens at render time (in-memory) so page nav doesn't re-query.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file?.id) return
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('source_file_id', file!.id)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) {
        toast.error(`Couldn't load measurements: ${error.message}`)
        return
      }
      setMeasurements((data ?? []) as Measurement[])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [file?.id])

  // ──────────────────────────────────────────────────────────────────
  // 2b. Load the scale calibration for the current (file, page). Null
  //     means "not calibrated yet". Re-runs on page nav. Non-critical
  //     — toast on error but don't tear down the view.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file?.id) {
      setPageScale(null)
      return
    }
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('page_scales')
        .select('*')
        .eq('source_file_id', file!.id)
        .eq('pdf_page_number', pageNumber)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        toast.error(`Couldn't load page scale: ${error.message}`)
        return
      }
      setPageScale((data ?? null) as PageScale | null)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [file?.id, pageNumber])

  // Switching pages should also drop any in-progress drafts — points
  // are PDF-page-units and would carry over invisibly to the new page.
  // Same reasoning as the selection clear.
  useEffect(() => {
    setCalibrationDraft({ points: [] })
    setLineDraft({ points: [] })
    setCountDraft(null)
    setAreaDraft(null)
    setPolylineDraft(null)
    setSelectedId(null)
  }, [pageNumber])

  // Phase 7 — viewport-width tracking for the mobile warning.
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < MIN_VIEWPORT_WIDTH)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Cancel any pending rubber-band RAF on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  // ──────────────────────────────────────────────────────────────────
  // 2c. Load work areas for the project. Phase 4 picker shows ALL of
  //     them ordered by sequence_order — there's no archive flag on
  //     work_areas yet (flag in handoff). Re-runs when the file's
  //     project changes.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file?.project_id) {
      setWorkAreas([])
      setDefaultWorkAreaId(null)
      return
    }
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('work_areas')
        .select('*')
        .eq('project_id', file!.project_id)
        .order('sequence_order', { ascending: true })
      if (cancelled) return
      if (error) {
        toast.error(`Couldn't load work areas: ${error.message}`)
        setWorkAreas([])
        return
      }
      setWorkAreas((data ?? []) as WorkArea[])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [file?.project_id])

  // Modal opens 250ms after the user clicks the second calibration
  // point. That window lets the overlay render effect paint the
  // second gold dot + dashed line so the user sees their click
  // before the modal covers the canvas. If the draft is cleared
  // (Esc / Cancel / submit) before the timer fires, the effect
  // cleanup cancels the timer — no stale modal opens.
  useEffect(() => {
    if (calibrationDraft.points.length !== 2) {
      setShowCalibrationModal(false)
      return
    }
    const t = window.setTimeout(() => setShowCalibrationModal(true), 250)
    return () => {
      window.clearTimeout(t)
    }
  }, [calibrationDraft.points.length])

  // ──────────────────────────────────────────────────────────────────
  // Line-tool commit: when the draft has both points, give the user
  // 250ms to see the rendered segment + dots, then INSERT into the DB.
  // Mirror the calibration delay pattern for consistent feedback.
  //
  // Stored fields (per Measurement schema):
  //   points          — [p1, p2] in PDF page units
  //   pdf_page_number — current page
  //   scale_factor    — captured at insert time (denormalized)
  //   calculated_value/unit — populated for export/reporting, BUT the
  //   UI never reads these. Labels are always recomputed at render
  //   time from the LIVE pageScale (see realWorldDistanceFor in the
  //   sidebar). That way recalibration immediately updates every label
  //   without rewriting rows. If a future phase wants the stored value
  //   for some reason, re-validate this decision — don't quietly start
  //   reading it from the UI render path.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tool !== 'line') return
    if (lineDraft.points.length !== 2) return
    if (!file || !pageScale) {
      // Shouldn't reach — line tool is gated on pageScale — but be
      // defensive so we don't ship a half-committed draft.
      setLineDraft({ points: [] })
      setTool('select')
      return
    }
    let cancelled = false
    const t = window.setTimeout(async () => {
      if (cancelled) return
      const [p1, p2] = lineDraft.points
      const pdfDistance = distanceBetweenPoints(p1, p2)
      const realWorld = pdfDistance * pageScale.scale_factor
      const payload = {
        project_id: file.project_id,
        source_file_id: file.id,
        pdf_page_number: pageNumber,
        tool_type: 'line' as const,
        points: lineDraft.points,
        work_area_id: defaultWorkAreaId,
        scale_factor: pageScale.scale_factor,
        calculated_value: realWorld,
        calculated_unit: pageScale.real_world_unit,
      }
      const { data, error } = await supabase
        .from('measurements')
        .insert(payload)
        .select()
        .single()
      if (cancelled) return
      if (error || !data) {
        toast.error(`Couldn't save measurement: ${error?.message ?? 'no row returned'}`)
        setLineDraft({ points: [] })
        setTool('select')
        return
      }
      setMeasurements((prev) => [...prev, data as Measurement])
      setLineDraft({ points: [] })
      setTool('select')
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [
    tool,
    lineDraft,
    file,
    pageScale,
    pageNumber,
    defaultWorkAreaId,
  ])

  // ──────────────────────────────────────────────────────────────────
  // 3. Track the rendering container's width via ResizeObserver so
  //    fit-to-width re-renders on window resize / sidebar toggle.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = measureRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setContainerWidth(Math.floor(w))
    })
    obs.observe(el)
    setContainerWidth(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  // ──────────────────────────────────────────────────────────────────
  // 4. Render the current PDF page to canvas + publish renderInfo.
  //    Re-runs on doc/page/width changes. Cancels any in-flight render
  //    task so rapid page-flips don't pile up.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc || containerWidth === 0) return
    let cancelled = false

    async function render() {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }

      let page
      try {
        page = await doc!.getPage(pageNumber)
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            `Couldn't load page ${pageNumber}: ${(err as Error).message}`
          )
          setLoadState('error')
        }
        return
      }
      if (cancelled) return

      const canvas = pdfCanvasRef.current
      if (!canvas) return

      const base = page.getViewport({ scale: 1 })
      const fitScale = containerWidth / base.width
      // Cap DPR at 2 — beyond that the canvas backing store blows up
      // with marginal visual gain (and many phones report 3+).
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: fitScale * dpr })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(fitScale * base.width)}px`
      canvas.style.height = `${Math.floor(fitScale * base.height)}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // pdfjs v5 requires `canvas` alongside `canvasContext` (both point
      // at the same element).
      const task = page.render({ canvasContext: ctx, viewport, canvas })
      renderTaskRef.current = task

      try {
        await task.promise
        if (!cancelled) {
          // Publish the snapshot AFTER successful render so the overlay
          // never tries to size against a half-failed page.
          setRenderInfo({
            pdfWidth: base.width,
            pdfHeight: base.height,
            fitScale,
            dpr,
          })
          setLoadState('ready')
        }
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (name !== 'RenderingCancelledException' && !cancelled) {
          setErrorMessage(`Render failed: ${(err as Error).message}`)
          setLoadState('error')
        }
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null
      }
    }

    void render()
    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [doc, pageNumber, containerWidth])

  // ──────────────────────────────────────────────────────────────────
  // 5. Overlay render — re-runs whenever the underlying PDF render
  //    changes (renderInfo), measurements change (data load + future
  //    inserts), the user changes pages, or selection changes.
  //
  //    Sizes the overlay canvas to match the PDF canvas EXACTLY in both
  //    backing-store and CSS dimensions. Uses ctx.scale(dpr, dpr) once
  //    so all subsequent draw calls work in CSS px space.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || !renderInfo) return

    const { fitScale, pdfWidth, pdfHeight, dpr } = renderInfo
    const cssWidth = Math.floor(fitScale * pdfWidth)
    const cssHeight = Math.floor(fitScale * pdfHeight)

    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Reset any transform from a prior render — without this, every
    // render compounds the dpr scale.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    const visible = getMeasurementsForPage(measurements, pageNumber)
    for (const m of visible) {
      if (m.tool_type === 'line') {
        const pts = parseLinePoints(m.points)
        if (!pts) continue
        const [a, b] = pts
        const aCss = pdfPageToCanvas(a, fitScale)
        const bCss = pdfPageToCanvas(b, fitScale)
        ctx.strokeStyle = m.id === selectedId ? BRAND_GOLD : BRAND_NAVY
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(aCss.x, aCss.y)
        ctx.lineTo(bCss.x, bCss.y)
        ctx.stroke()
      }
      // Other tool_types are no-op in Phase 2. Phases 5–7 add them.
    }

    // Phase 4 — real-world distance labels on each line measurement.
    // Read fitScale from renderInfo here; pageScale is the LIVE scale
    // so recalibration repaints every label immediately. Skip when
    // there's no scale yet (rare — labels would be meaningless).
    if (pageScale) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (const m of visible) {
        if (m.tool_type !== 'line') continue
        const pts = parseLinePoints(m.points)
        if (!pts) continue
        const midPdf = midpoint(pts[0] as Point, pts[1] as Point)
        const midCss = pdfPageToCanvas(midPdf, fitScale)
        const pdfDistance = distanceBetweenPoints(
          pts[0] as Point,
          pts[1] as Point
        )
        const realWorld = pdfDistance * pageScale.scale_factor
        const label = `${realWorld.toFixed(1)} ${pageScale.real_world_unit}`
        const textWidth = ctx.measureText(label).width
        const padX = 5
        const padY = 3
        const rectW = textWidth + padX * 2
        const rectH = 11 + padY * 2
        // Semi-opaque white rect so the label stays readable over any
        // plan color underneath (greens, navy plan lines, photos, etc).
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fillRect(
          midCss.x - rectW / 2,
          midCss.y - rectH / 2,
          rectW,
          rectH
        )
        ctx.fillStyle = '#5C6B8A' // brand-text-muted
        ctx.fillText(label, midCss.x, midCss.y)
      }
    }

    // Phase 3 — draw the in-progress calibration draft on top of any
    // measurements. Dots are drawn for each clicked point; a connecting
    // segment is drawn once both points exist (one render frame before
    // the modal opens, so the user briefly sees their calibration).
    const draftPoints = calibrationDraft.points
    if (draftPoints.length > 0) {
      ctx.fillStyle = BRAND_GOLD
      ctx.strokeStyle = BRAND_GOLD
      for (const p of draftPoints) {
        const css = pdfPageToCanvas(p, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, CALIBRATION_DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }
      if (draftPoints.length === 2) {
        const a = pdfPageToCanvas(draftPoints[0], fitScale)
        const b = pdfPageToCanvas(draftPoints[1], fitScale)
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Phase 4 — line tool draft. Navy (not gold) to distinguish from
    // calibration. Solid line preview (not dashed) since this becomes
    // a permanent measurement vs calibration's transient reference.
    const linePts = lineDraft.points
    if (linePts.length > 0) {
      ctx.fillStyle = BRAND_NAVY
      ctx.strokeStyle = BRAND_NAVY
      for (const p of linePts) {
        const css = pdfPageToCanvas(p, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, CALIBRATION_DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }
      if (linePts.length === 2) {
        const a = pdfPageToCanvas(linePts[0], fitScale)
        const b = pdfPageToCanvas(linePts[1], fitScale)
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    // Phase 5 — saved count measurements. Each marker is a numbered
    // circle. Whole-measurement selection (every marker in a selected
    // count flips to gold) — the per-marker click just resolves to
    // the parent measurement's id.
    ctx.font = '700 11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (const m of visible) {
      if (m.tool_type !== 'count') continue
      const pts = parseCountPoints(m.points)
      if (!pts) continue
      const isSelected = m.id === selectedId
      ctx.fillStyle = isSelected ? BRAND_GOLD : BRAND_NAVY
      pts.forEach((p, i) => {
        const css = pdfPageToCanvas(p, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, COUNT_MARKER_RADIUS, 0, Math.PI * 2)
        ctx.fill()
        // White centered number on top of the circle fill.
        ctx.fillStyle = '#FFFFFF'
        ctx.fillText(String(i + 1), css.x, css.y + 0.5)
        // Restore for next marker iteration.
        ctx.fillStyle = isSelected ? BRAND_GOLD : BRAND_NAVY
      })
    }

    // Phase 5 — count session draft (in-progress, not yet saved).
    // Identical rendering to a saved count except always navy (drafts
    // can't be selected). Stops appearing the instant the parent
    // clears countDraft (save success or cancel).
    if (countDraft && countDraft.points.length > 0) {
      ctx.fillStyle = BRAND_NAVY
      countDraft.points.forEach((p, i) => {
        const css = pdfPageToCanvas(p, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, COUNT_MARKER_RADIUS, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#FFFFFF'
        ctx.fillText(String(i + 1), css.x, css.y + 0.5)
        ctx.fillStyle = BRAND_NAVY
      })
    }

    // Phase 6 — saved area polygons. Closed shape: outline + translucent
    // fill. Selected: gold treatment. Vertices NOT individually drawn
    // (clean look for shapes that may have many vertices).
    if (pageScale) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (const m of visible) {
        if (m.tool_type !== 'area') continue
        const verts = parseAreaPoints(m.points)
        if (!verts) continue
        const isSelected = m.id === selectedId
        ctx.beginPath()
        verts.forEach((v, i) => {
          const css = pdfPageToCanvas(v, fitScale)
          if (i === 0) ctx.moveTo(css.x, css.y)
          else ctx.lineTo(css.x, css.y)
        })
        ctx.closePath() // implicit closing edge from last vertex to first
        ctx.fillStyle = isSelected ? AREA_FILL_SELECTED : AREA_FILL_UNSELECTED
        ctx.fill()
        ctx.strokeStyle = isSelected ? BRAND_GOLD : BRAND_NAVY
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.stroke()

        // Area label at the polygon's centroid (average of vertices —
        // fine for convex shapes; concave shapes may land label
        // outside the polygon, Phase 7 polish could use a proper
        // visual centroid). Same live-state pattern as line labels:
        // recompute area × scale_factor² every render.
        const cx =
          verts.reduce((s, v) => s + v.x, 0) / verts.length
        const cy =
          verts.reduce((s, v) => s + v.y, 0) / verts.length
        const centroidCss = pdfPageToCanvas({ x: cx, y: cy }, fitScale)
        const realArea = realWorldArea(polygonArea(verts), pageScale.scale_factor)
        const label = formatArea(realArea, pageScale.real_world_unit)
        const textWidth = ctx.measureText(label).width
        const padX = 5
        const padY = 3
        const rectW = textWidth + padX * 2
        const rectH = 11 + padY * 2
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fillRect(
          centroidCss.x - rectW / 2,
          centroidCss.y - rectH / 2,
          rectW,
          rectH
        )
        ctx.fillStyle = '#5C6B8A' // brand-text-muted
        ctx.fillText(label, centroidCss.x, centroidCss.y)
      }
    }

    // Phase 6 — area session draft. Open polygon (no closing edge to
    // first vertex). Small navy dots at each vertex for visual
    // feedback during collection. No fill while drafting.
    if (areaDraft && areaDraft.points.length > 0) {
      const pts = areaDraft.points
      ctx.strokeStyle = BRAND_NAVY
      ctx.fillStyle = BRAND_NAVY
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pts.length >= 2) {
        ctx.beginPath()
        pts.forEach((v, i) => {
          const css = pdfPageToCanvas(v, fitScale)
          if (i === 0) ctx.moveTo(css.x, css.y)
          else ctx.lineTo(css.x, css.y)
        })
        // Intentionally NOT closePath — drafts render as OPEN polygons
        // so the user sees they haven't finished yet.
        ctx.stroke()
      }
      pts.forEach((v) => {
        const css = pdfPageToCanvas(v, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, AREA_DRAFT_DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    // Phase 7 — saved freehand polylines. Open: outline only. Closed:
    // outline + translucent fill (same fill as area). Vertex dots
    // visible on both for the dotted-feel of a hand-traced shape.
    // Label at centroid (closed) or above midpoint vertex (open).
    if (pageScale) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (const m of visible) {
        if (m.tool_type !== 'freehand_polyline') continue
        const parsed = parsePolylinePoints(m.points)
        if (!parsed) continue
        const isSelected = m.id === selectedId

        ctx.beginPath()
        parsed.points.forEach((v, i) => {
          const css = pdfPageToCanvas(v, fitScale)
          if (i === 0) ctx.moveTo(css.x, css.y)
          else ctx.lineTo(css.x, css.y)
        })
        if (parsed.closed) ctx.closePath()

        if (parsed.closed) {
          ctx.fillStyle = isSelected ? AREA_FILL_SELECTED : AREA_FILL_UNSELECTED
          ctx.fill()
        }
        ctx.strokeStyle = isSelected ? BRAND_GOLD : BRAND_NAVY
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()

        ctx.fillStyle = isSelected ? BRAND_GOLD : BRAND_NAVY
        parsed.points.forEach((v) => {
          const css = pdfPageToCanvas(v, fitScale)
          ctx.beginPath()
          ctx.arc(css.x, css.y, 2.5, 0, Math.PI * 2)
          ctx.fill()
        })

        // Label
        const perim =
          polylinePerimeter(parsed.points, parsed.closed) *
          pageScale.scale_factor
        const perimStr = `${perim.toFixed(1)} ${pageScale.real_world_unit}`
        let labelText: string
        let labelX: number
        let labelY: number
        if (parsed.closed) {
          const realA = realWorldArea(
            polygonArea(parsed.points),
            pageScale.scale_factor
          )
          const areaStr = new Intl.NumberFormat('en-US', {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
          }).format(realA)
          labelText = `${perimStr} · ${areaStr} sq ${pageScale.real_world_unit}`
          const cx =
            parsed.points.reduce((s, v) => s + v.x, 0) / parsed.points.length
          const cy =
            parsed.points.reduce((s, v) => s + v.y, 0) / parsed.points.length
          const c = pdfPageToCanvas({ x: cx, y: cy }, fitScale)
          labelX = c.x
          labelY = c.y
        } else {
          labelText = `Perim ${perimStr}`
          // Anchor near the middle vertex, offset above so label doesn't
          // sit on the line.
          const mid =
            parsed.points[Math.floor(parsed.points.length / 2)]
          const c = pdfPageToCanvas(mid, fitScale)
          labelX = c.x
          labelY = c.y - 14
        }
        const tw = ctx.measureText(labelText).width
        const padX = 5
        const padY = 3
        const rectW = tw + padX * 2
        const rectH = 11 + padY * 2
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fillRect(labelX - rectW / 2, labelY - rectH / 2, rectW, rectH)
        ctx.fillStyle = '#5C6B8A'
        ctx.fillText(labelText, labelX, labelY)
      }
    }

    // Phase 7 — polyline draft. Always open (closing happens on commit).
    // Vertex dots; first vertex slightly larger as the close-target.
    if (polylineDraft && polylineDraft.points.length > 0) {
      const pts = polylineDraft.points
      ctx.strokeStyle = BRAND_NAVY
      ctx.fillStyle = BRAND_NAVY
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pts.length >= 2) {
        ctx.beginPath()
        pts.forEach((v, i) => {
          const css = pdfPageToCanvas(v, fitScale)
          if (i === 0) ctx.moveTo(css.x, css.y)
          else ctx.lineTo(css.x, css.y)
        })
        ctx.stroke()
      }
      pts.forEach((v, i) => {
        const css = pdfPageToCanvas(v, fitScale)
        ctx.beginPath()
        ctx.arc(css.x, css.y, i === 0 ? 4 : 2.5, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    // Phase 7 — rubber-band preview from the last placed vertex to
    // the cursor, while a draft is in flight + cursor is over the
    // canvas. Cursor is read from cursorPdfRef (ref-based to avoid
    // re-renders on every move); RAF coalesces moves; rubberBandTick
    // in deps re-runs this effect per RAF.
    const cursor = cursorPdfRef.current
    if (cursor) {
      let anchor: Point | null = null
      let rubberColor: string = BRAND_NAVY
      if (tool === 'calibrate' && calibrationDraft.points.length === 1) {
        anchor = calibrationDraft.points[0]
        rubberColor = BRAND_GOLD
      } else if (tool === 'line' && lineDraft.points.length === 1) {
        anchor = lineDraft.points[0]
      } else if (
        tool === 'area' &&
        areaDraft &&
        areaDraft.status === 'collecting' &&
        areaDraft.points.length >= 1
      ) {
        anchor = areaDraft.points[areaDraft.points.length - 1]
      } else if (
        tool === 'freehand' &&
        polylineDraft &&
        polylineDraft.status === 'collecting' &&
        polylineDraft.points.length >= 1
      ) {
        anchor = polylineDraft.points[polylineDraft.points.length - 1]
      }
      if (anchor) {
        const a = pdfPageToCanvas(anchor, fitScale)
        const b = pdfPageToCanvas(cursor, fitScale)
        ctx.strokeStyle = rubberColor
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }, [
    renderInfo,
    measurements,
    selectedId,
    pageNumber,
    calibrationDraft,
    lineDraft,
    pageScale,
    countDraft,
    areaDraft,
    polylineDraft,
    tool,
    rubberBandTick,
  ])

  // ──────────────────────────────────────────────────────────────────
  // 6. ESC routing.
  //
  //    Priority (highest first):
  //      1. Calibration in progress (1+ points clicked OR modal open)
  //         → cancel calibration, revert to Select tool.
  //      2. Otherwise → deselect any selected measurement.
  //
  //    Same handler covers all three (the modal traps its own focus
  //    but doesn't swallow Esc when implemented via the project's
  //    Modal component — verified separately).
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Priority order: calibration > count > area > line > deselect.
      // Each tool's draft Esc cancels its session fully (no DB write),
      // including from the label-modal stage. Only one draft is
      // realistically active at a time given the tool-change reset.
      if (calibrationDraft.points.length > 0) {
        setCalibrationDraft({ points: [] })
        setTool('select')
        return
      }
      if (countDraft !== null) {
        setCountDraft(null)
        setTool('select')
        return
      }
      if (areaDraft !== null) {
        setAreaDraft(null)
        setTool('select')
        return
      }
      if (polylineDraft !== null) {
        setPolylineDraft(null)
        setTool('select')
        return
      }
      if (lineDraft.points.length > 0) {
        setLineDraft({ points: [] })
        setTool('select')
        return
      }
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    calibrationDraft.points.length,
    countDraft,
    areaDraft,
    polylineDraft,
    lineDraft.points.length,
  ])

  // ──────────────────────────────────────────────────────────────────
  // Phase 7 — keyboard shortcuts. V/L/C/A/F/K map to the toolbar tools.
  // Gated on focus NOT being in a form field (INPUT/TEXTAREA/SELECT)
  // and on modifier keys NOT being held (those are browser shortcuts).
  // Disabled tools (line/area/freehand without pageScale) are
  // double-gated here so keyboard can't bypass the toolbar's disabled
  // state.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const SHORTCUTS: Record<string, MeasureToolMode> = {
      v: 'select',
      k: 'calibrate',
      l: 'line',
      c: 'count',
      a: 'area',
      f: 'freehand',
    }
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const next = SHORTCUTS[e.key.toLowerCase()]
      if (!next) return
      // Mirror the toolbar's pageScale gating.
      if ((next === 'line' || next === 'area' || next === 'freehand') && !pageScale) {
        return
      }
      setTool(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pageScale])

  // ──────────────────────────────────────────────────────────────────
  // Delete key on canvas/sidebar focus → open the delete-confirm dialog
  // for the selected measurement. Excludes Backspace (browser-back
  // collision) and ignores when the focused element is an input/select/
  // textarea so typing a number into the calibration panel doesn't
  // wipe a selected line.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete') return
      if (selectedId === null) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const m = measurements.find((x) => x.id === selectedId)
      if (m) setDeleteTarget(m)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, measurements])

  // ──────────────────────────────────────────────────────────────────
  // 7. Overlay pointer-down — hit-test in CSS canvas px space.
  //
  //    Deselect property (from Phase 2 plan): the deselect-on-empty-space
  //    behavior only fires when the click is on the overlay canvas AND
  //    > HIT_THRESHOLD from any measurement. Clicks on the toolbar,
  //    page navigator, sub-header, or any other AppShell chrome do NOT
  //    trigger deselect because pointer events on those elements never
  //    reach this handler. Don't add a document-level handler for this.
  // ──────────────────────────────────────────────────────────────────
  const onOverlayPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!renderInfo) return

      const canvas = e.currentTarget
      const rect = canvas.getBoundingClientRect()

      if (tool === 'calibrate') {
        // Phase 3: accumulate two PDF-page-unit points. Second click
        // triggers the modal (via the derived calibrationDraft.length).
        // If we somehow get a 3rd click while 2 are buffered (e.g. the
        // modal closed without resetting), ignore — modal owns the
        // resolution.
        if (calibrationDraft.points.length >= 2) return
        const pdfPoint = screenToPdfPage(
          { x: e.clientX, y: e.clientY },
          rect,
          renderInfo.fitScale
        )
        setCalibrationDraft((prev) => ({ points: [...prev.points, pdfPoint] }))
        return
      }

      if (tool === 'line') {
        // Phase 4: accumulate two PDF-page-unit points. Second click
        // commits via the delayed line-commit effect.
        if (!pageScale) {
          // Defensive — line tool is gated on pageScale so this should
          // be unreachable. Defaulting to Select keeps the user out of
          // a broken state.
          setTool('select')
          return
        }
        if (lineDraft.points.length >= 2) return
        const pdfPoint = screenToPdfPage(
          { x: e.clientX, y: e.clientY },
          rect,
          renderInfo.fitScale
        )
        setLineDraft((prev) => ({ points: [...prev.points, pdfPoint] }))
        return
      }

      if (tool === 'count') {
        // Phase 5: accumulate N PDF-page-unit points. Once the modal
        // is up (status awaiting_label), the modal owns input — no
        // more canvas clicks allowed.
        if (countDraft?.status === 'awaiting_label') return
        const pdfPoint = screenToPdfPage(
          { x: e.clientX, y: e.clientY },
          rect,
          renderInfo.fitScale
        )
        setCountDraft((prev) => ({
          points: prev ? [...prev.points, pdfPoint] : [pdfPoint],
          status: 'collecting',
        }))
        return
      }

      if (tool === 'area') {
        // Phase 6: accumulate polygon vertices. ≥3 required to Finish
        // (gated in AreaPanel). Modal-stage clicks ignored.
        if (!pageScale) {
          setTool('select')
          return
        }
        if (areaDraft?.status === 'awaiting_label') return
        const pdfPoint = screenToPdfPage(
          { x: e.clientX, y: e.clientY },
          rect,
          renderInfo.fitScale
        )
        setAreaDraft((prev) => ({
          points: prev ? [...prev.points, pdfPoint] : [pdfPoint],
          status: 'collecting',
        }))
        return
      }

      if (tool === 'freehand') {
        // Phase 7 — N-click polyline with two completion paths:
        //   - Finish button       → open polyline (perimeter only)
        //   - Click first vertex  → closed polyline (perimeter + area)
        // Close detection requires ALL of:
        //   (a) ≥3 vertices already collected
        //   (b) click within POLYLINE_CLOSE_RADIUS CSS px of first vertex
        //   (c) at least one intermediate vertex is > POLYLINE_CLOSE_MIN_TRAVEL
        //       CSS px from the first vertex (i.e. user actually moved away)
        // All three together prevent accidental close on early clicks
        // that just happen to land near the first vertex.
        if (!pageScale) {
          setTool('select')
          return
        }
        if (polylineDraft?.status === 'awaiting_label') return

        const cssX = e.clientX - rect.left
        const cssY = e.clientY - rect.top

        // Try close detection first when conditions allow.
        if (
          polylineDraft &&
          polylineDraft.status === 'collecting' &&
          polylineDraft.points.length >= 3
        ) {
          const firstCss = pdfPageToCanvas(
            polylineDraft.points[0],
            renderInfo.fitScale
          )
          const distToFirst = distanceBetweenPoints(
            { x: cssX, y: cssY },
            firstCss
          )
          if (distToFirst <= POLYLINE_CLOSE_RADIUS) {
            const movedAway = polylineDraft.points.slice(1).some((p) => {
              const pCss = pdfPageToCanvas(p, renderInfo.fitScale)
              return distanceBetweenPoints(pCss, firstCss) >
                POLYLINE_CLOSE_MIN_TRAVEL
            })
            if (movedAway) {
              // Close — append first vertex as duplicate (storage encoding
              // for closed) and transition to label modal.
              setPolylineDraft({
                points: [...polylineDraft.points, polylineDraft.points[0]],
                status: 'awaiting_label',
                closed: true,
              })
              return
            }
          }
        }

        // Otherwise, normal vertex append.
        const pdfPoint = screenToPdfPage(
          { x: e.clientX, y: e.clientY },
          rect,
          renderInfo.fitScale
        )
        setPolylineDraft((prev) => ({
          points: prev ? [...prev.points, pdfPoint] : [pdfPoint],
          status: 'collecting',
          closed: false,
        }))
        return
      }

      if (tool !== 'select') {
        // Tool with no handler — defensive return.
        return
      }

      const cssX = e.clientX - rect.left
      const cssY = e.clientY - rect.top

      const visible = getMeasurementsForPage(measurements, pageNumber)
      let hit: string | null = null
      for (const m of visible) {
        if (m.tool_type === 'line') {
          const pts = parseLinePoints(m.points)
          if (!pts) continue
          const [a, b] = pts
          const aCss = pdfPageToCanvas(a, renderInfo.fitScale)
          const bCss = pdfPageToCanvas(b, renderInfo.fitScale)
          const dist = distancePointToSegment({ x: cssX, y: cssY }, aCss, bCss)
          if (dist < HIT_THRESHOLD) {
            // Last-match-wins so the most-recently-drawn line wins ties
            // (matches typical canvas-app expectations).
            hit = m.id
          }
        } else if (m.tool_type === 'count') {
          // Phase 5 — whole-measurement selection on a count: any
          // marker click resolves to the parent count.id. Threshold
          // = marker radius + standard HIT_THRESHOLD so the click
          // area extends slightly past the visible circle edge.
          const pts = parseCountPoints(m.points)
          if (!pts) continue
          for (const p of pts) {
            const css = pdfPageToCanvas(p, renderInfo.fitScale)
            if (
              pointInCircle(
                { x: cssX, y: cssY },
                css,
                COUNT_MARKER_RADIUS + HIT_THRESHOLD
              )
            ) {
              hit = m.id
              break // no need to check other markers of same count
            }
          }
        } else if (m.tool_type === 'area') {
          // Phase 6 — hit on point-in-polygon (click inside the
          // shape) OR within HIT_THRESHOLD of any edge segment
          // (click near the outline). Convert all vertices to CSS
          // once.
          const verts = parseAreaPoints(m.points)
          if (!verts) continue
          const vertsCss = verts.map((v) =>
            pdfPageToCanvas(v, renderInfo.fitScale)
          )
          if (pointInPolygon({ x: cssX, y: cssY }, vertsCss)) {
            hit = m.id
            continue
          }
          // Edge-proximity check — last edge wraps last → first.
          for (let i = 0; i < vertsCss.length; i++) {
            const a = vertsCss[i]
            const b = vertsCss[(i + 1) % vertsCss.length]
            if (
              distancePointToSegment({ x: cssX, y: cssY }, a, b) <
              HIT_THRESHOLD
            ) {
              hit = m.id
              break
            }
          }
        } else if (m.tool_type === 'freehand_polyline') {
          // Phase 7 — closed: same union as area (point-in-polygon OR
          // edge-proximity, incl. closing edge). Open: edge-proximity
          // only across N-1 edges (no closing edge, no interior).
          const parsed = parsePolylinePoints(m.points)
          if (!parsed) continue
          const vertsCss = parsed.points.map((v) =>
            pdfPageToCanvas(v, renderInfo.fitScale)
          )
          if (parsed.closed && pointInPolygon({ x: cssX, y: cssY }, vertsCss)) {
            hit = m.id
            continue
          }
          let polyHit = false
          for (let i = 0; i < vertsCss.length - 1; i++) {
            if (
              distancePointToSegment({ x: cssX, y: cssY }, vertsCss[i], vertsCss[i + 1]) <
              HIT_THRESHOLD
            ) {
              polyHit = true
              break
            }
          }
          if (!polyHit && parsed.closed) {
            // Closing edge for closed polylines.
            if (
              distancePointToSegment(
                { x: cssX, y: cssY },
                vertsCss[vertsCss.length - 1],
                vertsCss[0]
              ) < HIT_THRESHOLD
            ) {
              polyHit = true
            }
          }
          if (polyHit) hit = m.id
        }
      }
      // null when click was on canvas but > HIT_THRESHOLD from any
      // measurement — that's the deselect path.
      setSelectedId(hit)
    },
    [
      renderInfo,
      tool,
      measurements,
      pageNumber,
      calibrationDraft.points.length,
      lineDraft.points.length,
      countDraft,
      areaDraft,
      polylineDraft,
      pageScale,
    ]
  )

  // ──────────────────────────────────────────────────────────────────
  // Phase 7 — pointer-move handler for rubber-band preview.
  //
  // Only active when there's a draft that benefits from a preview:
  //   - calibration with 1 point clicked
  //   - line with 1 point clicked
  //   - area while collecting (≥1 vertex)
  //   - polyline while collecting (≥1 vertex)
  // Count doesn't get rubber-band (clicks are independent markers).
  //
  // Cursor position lives in a ref to avoid React re-renders on every
  // mouse move. RAF coalesces moves to one redraw per frame; the
  // rubberBandTick state bump inside RAF re-runs the overlay render
  // effect (which has rubberBandTick in its deps).
  // ──────────────────────────────────────────────────────────────────
  const onOverlayPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!renderInfo) return
      const hasRubberBand =
        (tool === 'calibrate' && calibrationDraft.points.length === 1) ||
        (tool === 'line' && lineDraft.points.length === 1) ||
        (tool === 'area' &&
          areaDraft !== null &&
          areaDraft.status === 'collecting' &&
          areaDraft.points.length >= 1) ||
        (tool === 'freehand' &&
          polylineDraft !== null &&
          polylineDraft.status === 'collecting' &&
          polylineDraft.points.length >= 1)
      if (!hasRubberBand) return

      const canvas = e.currentTarget
      const rect = canvas.getBoundingClientRect()
      cursorPdfRef.current = screenToPdfPage(
        { x: e.clientX, y: e.clientY },
        rect,
        renderInfo.fitScale
      )
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          setRubberBandTick((t) => t + 1)
        })
      }
    },
    [
      renderInfo,
      tool,
      calibrationDraft.points.length,
      lineDraft.points.length,
      areaDraft,
      polylineDraft,
    ]
  )

  const onOverlayPointerLeave = useCallback(() => {
    if (cursorPdfRef.current !== null) {
      cursorPdfRef.current = null
      setRubberBandTick((t) => t + 1)
    }
  }, [])

  // ──────────────────────────────────────────────────────────────────
  // Calibration submit + cancel.
  //
  // UPSERT pattern: one page_scales row per (source_file_id,
  // pdf_page_number) — recalibration replaces the existing row.
  // ──────────────────────────────────────────────────────────────────
  const handleCalibrationSubmit = useCallback(
    async (distance: number, unit: RealWorldUnit) => {
      if (calibrationDraft.points.length !== 2) return
      if (!file) return
      const [p1, p2] = calibrationDraft.points
      let scaleFactor: number
      try {
        scaleFactor = computeScaleFactor(p1, p2, distance)
      } catch (err) {
        toast.error((err as Error).message)
        return
      }
      const payload = {
        project_id: file.project_id,
        source_file_id: file.id,
        pdf_page_number: pageNumber,
        calibration_points: calibrationDraft.points,
        real_world_distance: distance,
        real_world_unit: unit,
        scale_factor: scaleFactor,
      }
      const { data, error } = await supabase
        .from('page_scales')
        .upsert(payload, { onConflict: 'source_file_id,pdf_page_number' })
        .select()
        .single()
      if (error || !data) {
        const msg = error?.message ?? 'No row returned from upsert'
        toast.error(`Couldn't save calibration: ${msg}`)
        throw new Error(msg)
      }
      setPageScale(data as PageScale)
      setCalibrationDraft({ points: [] })
      setTool('select')
      toast.success(`Page calibrated: ${distance} ${unit}`)
    },
    [calibrationDraft.points, file, pageNumber]
  )

  const handleCalibrationCancel = useCallback(() => {
    setCalibrationDraft({ points: [] })
    setTool('select')
  }, [])

  // ──────────────────────────────────────────────────────────────────
  // Measurement delete — sidebar's Delete button + Delete key both
  // route through here. Confirm dialog before the DB call.
  // ──────────────────────────────────────────────────────────────────
  const requestDeleteMeasurement = useCallback(
    (id: string) => {
      const m = measurements.find((x) => x.id === id)
      if (m) setDeleteTarget(m)
    },
    [measurements]
  )

  // ──────────────────────────────────────────────────────────────────
  // Count session handlers — Finish locks the markers and opens the
  // label modal; Cancel + ESC fully discard; the label submit inserts
  // the row and clears the session.
  // ──────────────────────────────────────────────────────────────────
  const handleCountFinish = useCallback(() => {
    if (!countDraft || countDraft.points.length === 0) return
    setCountDraft({ points: countDraft.points, status: 'awaiting_label' })
  }, [countDraft])

  const handleCountCancel = useCallback(() => {
    setCountDraft(null)
    setTool('select')
  }, [])

  const handleCountSubmitLabel = useCallback(
    async (label: string | null) => {
      if (!countDraft || countDraft.points.length === 0 || !file) return
      const payload = {
        project_id: file.project_id,
        source_file_id: file.id,
        pdf_page_number: pageNumber,
        tool_type: 'count' as const,
        points: countDraft.points,
        work_area_id: defaultWorkAreaId,
        label,
        // scale_factor is NOT NULL — counts don't use it but the column
        // requires a value. 1.0 keeps DB happy; UI never reads this
        // for counts.
        scale_factor: pageScale?.scale_factor ?? 1.0,
        // calculated_value populated for export/reporting, but the UI
        // reads count.points.length directly (live-state pattern from
        // Phase 4). Same rule applies to count as to line.
        calculated_value: countDraft.points.length,
        calculated_unit: 'each',
      }
      const { data, error } = await supabase
        .from('measurements')
        .insert(payload)
        .select()
        .single()
      if (error || !data) {
        const msg = error?.message ?? 'No row returned from insert'
        toast.error(`Couldn't save count: ${msg}`)
        throw new Error(msg) // keeps the label modal open
      }
      setMeasurements((prev) => [...prev, data as Measurement])
      setCountDraft(null)
      setTool('select')
      const noun = countDraft.points.length === 1 ? 'item' : 'items'
      toast.success(
        label
          ? `Count saved: ${countDraft.points.length} ${noun} (${label})`
          : `Count saved: ${countDraft.points.length} ${noun}`
      )
    },
    [countDraft, file, pageNumber, defaultWorkAreaId, pageScale]
  )

  // ──────────────────────────────────────────────────────────────────
  // Area session handlers — same shape as count but with the squared
  // scale factor for the real-world area calculation.
  // ──────────────────────────────────────────────────────────────────
  const handleAreaFinish = useCallback(() => {
    if (!areaDraft || areaDraft.points.length < 3) return
    setAreaDraft({ points: areaDraft.points, status: 'awaiting_label' })
  }, [areaDraft])

  const handleAreaCancel = useCallback(() => {
    setAreaDraft(null)
    setTool('select')
  }, [])

  const handleAreaSubmitLabel = useCallback(
    async (label: string | null) => {
      if (!areaDraft || areaDraft.points.length < 3 || !file || !pageScale) {
        return
      }
      const pdfArea = polygonArea(areaDraft.points)
      const realArea = realWorldArea(pdfArea, pageScale.scale_factor)
      const payload = {
        project_id: file.project_id,
        source_file_id: file.id,
        pdf_page_number: pageNumber,
        tool_type: 'area' as const,
        points: areaDraft.points,
        work_area_id: defaultWorkAreaId,
        label,
        scale_factor: pageScale.scale_factor,
        // Stored for export/reporting. UI always recomputes via the
        // realWorldArea helper from live pageScale — never reads this.
        calculated_value: realArea,
        calculated_unit: `sq ${pageScale.real_world_unit}`,
      }
      const { data, error } = await supabase
        .from('measurements')
        .insert(payload)
        .select()
        .single()
      if (error || !data) {
        const msg = error?.message ?? 'No row returned from insert'
        toast.error(`Couldn't save area: ${msg}`)
        throw new Error(msg)
      }
      setMeasurements((prev) => [...prev, data as Measurement])
      setAreaDraft(null)
      setTool('select')
      const display = formatArea(realArea, pageScale.real_world_unit)
      toast.success(
        label ? `Area saved: ${display} (${label})` : `Area saved: ${display}`
      )
    },
    [areaDraft, file, pageNumber, defaultWorkAreaId, pageScale]
  )

  // Pre-computed display string for the AreaLabelModal header. Uses
  // the same live-state recompute (polygonArea × scale²) so what the
  // modal shows matches what will be saved + later rendered.
  const areaDraftDisplay =
    areaDraft && areaDraft.status === 'awaiting_label' && pageScale
      ? formatArea(
          realWorldArea(polygonArea(areaDraft.points), pageScale.scale_factor),
          pageScale.real_world_unit
        )
      : ''

  // ──────────────────────────────────────────────────────────────────
  // Polyline session handlers.
  // Finish (open path): closed=false, transition to awaiting_label.
  // Cancel: full discard.
  // Submit label: insert with full points array (with duplicated first
  //   at end if closed). Perimeter goes into calculated_value /
  //   calculated_unit for export; UI ignores them per the live-state
  //   pattern (sidebar + canvas labels always recompute).
  // ──────────────────────────────────────────────────────────────────
  const handleFreehandFinish = useCallback(() => {
    if (!polylineDraft || polylineDraft.points.length < 2) return
    setPolylineDraft({
      points: polylineDraft.points,
      status: 'awaiting_label',
      closed: false,
    })
  }, [polylineDraft])

  const handleFreehandCancel = useCallback(() => {
    setPolylineDraft(null)
    setTool('select')
  }, [])

  const handleFreehandSubmitLabel = useCallback(
    async (label: string | null) => {
      if (!polylineDraft || !file || !pageScale) return
      if (polylineDraft.points.length < 2) return
      // For closed: points already ends with first-vertex duplicate.
      // Compute geometry against the clean (no-duplicate) vertex list.
      const cleanVerts = polylineDraft.closed
        ? polylineDraft.points.slice(0, -1)
        : polylineDraft.points
      const perim =
        polylinePerimeter(cleanVerts, polylineDraft.closed) *
        pageScale.scale_factor
      const payload = {
        project_id: file.project_id,
        source_file_id: file.id,
        pdf_page_number: pageNumber,
        tool_type: 'freehand_polyline' as const,
        points: polylineDraft.points,
        work_area_id: defaultWorkAreaId,
        label,
        scale_factor: pageScale.scale_factor,
        // calculated_value populated for export; UI never reads these
        // — sidebar + canvas labels recompute via realWorldPolylineFor /
        // polylinePerimeter every render (live-state pattern).
        calculated_value: perim,
        calculated_unit: pageScale.real_world_unit,
      }
      const { data, error } = await supabase
        .from('measurements')
        .insert(payload)
        .select()
        .single()
      if (error || !data) {
        const msg = error?.message ?? 'No row returned from insert'
        toast.error(`Couldn't save polyline: ${msg}`)
        throw new Error(msg)
      }
      setMeasurements((prev) => [...prev, data as Measurement])
      setPolylineDraft(null)
      setTool('select')
      const perimStr = `${perim.toFixed(1)} ${pageScale.real_world_unit}`
      const summary = polylineDraft.closed
        ? `closed polyline (perim ${perimStr})`
        : `open polyline (perim ${perimStr})`
      toast.success(
        label ? `Saved ${summary} — ${label}` : `Saved ${summary}`
      )
    },
    [polylineDraft, file, pageNumber, defaultWorkAreaId, pageScale]
  )

  // Pre-formatted strings for PolylineLabelModal header.
  const polylineDisplay = (() => {
    if (
      !polylineDraft ||
      polylineDraft.status !== 'awaiting_label' ||
      !pageScale
    ) {
      return { perim: '', area: '', closed: false }
    }
    const cleanVerts = polylineDraft.closed
      ? polylineDraft.points.slice(0, -1)
      : polylineDraft.points
    const perim =
      polylinePerimeter(cleanVerts, polylineDraft.closed) *
      pageScale.scale_factor
    const perimStr = `${perim.toFixed(1)} ${pageScale.real_world_unit}`
    let areaStr = ''
    if (polylineDraft.closed) {
      const ra = realWorldArea(polygonArea(cleanVerts), pageScale.scale_factor)
      areaStr = formatArea(ra, pageScale.real_world_unit)
    }
    return { perim: perimStr, area: areaStr, closed: polylineDraft.closed }
  })()

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    const { error } = await supabase
      .from('measurements')
      .delete()
      .eq('id', target.id)
    if (error) {
      toast.error(`Couldn't delete measurement: ${error.message}`)
      return
    }
    setMeasurements((prev) => prev.filter((m) => m.id !== target.id))
    if (selectedId === target.id) setSelectedId(null)
    setDeleteTarget(null)
    toast.success('Measurement deleted.')
  }, [deleteTarget, selectedId])

  // PDF-page-unit distance between the two clicked points, shown in the
  // modal as info. Zero when fewer than 2 points are clicked.
  const calibrationPdfDistance =
    calibrationDraft.points.length === 2
      ? distanceBetweenPoints(
          calibrationDraft.points[0],
          calibrationDraft.points[1]
        )
      : 0

  // ──────────────────────────────────────────────────────────────────
  // Page navigator handlers
  // ──────────────────────────────────────────────────────────────────
  const goPrev = useCallback(
    () => setPageNumber((p) => Math.max(1, p - 1)),
    []
  )
  const goNext = useCallback(
    () => setPageNumber((p) => Math.min(pageCount, p + 1)),
    [pageCount]
  )
  const onPageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isFinite(v)) return
      if (v < 1 || v > pageCount) return
      setPageNumber(v)
    },
    [pageCount]
  )

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────

  // Phase 7 — mobile / narrow-viewport guard. Replaces the entire
  // measure layout with a warning card when the viewport is below
  // MIN_VIEWPORT_WIDTH. Resizing past the threshold either direction
  // re-mounts the measure view via the isNarrow state change.
  if (isNarrow) {
    return <MobileWarning backTo={backTo} />
  }

  if (loadState === 'error') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-brand-text">
          {errorMessage ?? 'Something went wrong opening this file.'}
        </p>
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-header */}
      <div className="flex items-center gap-3 rounded-xl border border-brand-border bg-white px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-brand-text-muted hover:bg-brand-surface hover:text-brand-navy"
          title="Back to project"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div
          className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-text"
          title={file?.file_name ?? undefined}
        >
          {file?.file_name ?? 'Loading…'}
        </div>

        {/* Status strip moved to the sidebar in Phase 4 — page scale
            now lives in MeasureSidebar's "Scale" section. */}

        {pageCount > 0 && (
          <div className="flex shrink-0 items-center gap-1 text-sm">
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNumber <= 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-text-muted"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={pageNumber}
              onChange={onPageInput}
              className="h-7 w-12 rounded-md border border-brand-border bg-white text-center text-sm tabular-nums text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              aria-label="Page number"
            />
            <span className="text-brand-text-muted">
              / <span className="tabular-nums">{pageCount}</span>
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={pageNumber >= pageCount}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-text-muted"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Canvas + sidebar row. Outer flex container owns the card
          chrome (border, rounded, shadow); inner halves drop their own
          borders. overflow-hidden clips the rounded corners.
          min-w-0 on the canvas-area is mandatory — without it, the
          canvas's explicit pixel width gives canvas-area an implicit
          min-width: auto that lets it grow past its flex allotment,
          pushing the sidebar (incl. its collapsed-state expand button)
          off-screen and unreachable. */}
      <div className="flex min-h-[300px] overflow-hidden rounded-xl border border-brand-border bg-white shadow-sm">
        {/* Canvas area (left, grows) */}
        <div className="relative min-w-0 flex-1 p-3">
        {/* Floating tool toolbar — anchored top-left of the canvas area.
            Z above the canvas so it stays interactive when canvases are
            tall enough to scroll under it. */}
        <div className="absolute left-5 top-5 z-10">
          <MeasureToolbar
            tool={tool}
            onChange={setTool}
            enabledTools={
              pageScale
                ? [...PHASE5_BASE_TOOLS, 'line', 'area', 'freehand']
                : PHASE5_BASE_TOOLS
            }
            disabledReasons={
              pageScale
                ? undefined
                : {
                    line: LINE_DISABLED_NO_SCALE,
                    area: AREA_DISABLED_NO_SCALE,
                    freehand: FREEHAND_DISABLED_NO_SCALE,
                  }
            }
          />
        </div>

        {/* measureRef sits inside the padding so containerWidth is the
            actual available canvas width (parent.clientWidth - 2*12px). */}
        <div ref={measureRef} className="flex justify-center">
          {/* Stacking container — relative positioning anchors the
              overlay above the PDF canvas. inline-block shrink-wraps to
              the PDF canvas's CSS dimensions, so the wrapper is always
              exactly the same size as the canvas it contains (no inline
              style needed; size is driven by the canvas itself). The
              parent's flex justify-center centers this within the
              measureRef. */}
          <div className="relative inline-block">
            <canvas
              ref={pdfCanvasRef}
              className="pointer-events-none block bg-white"
              aria-label={
                file?.file_name
                  ? `Page ${pageNumber} of ${file.file_name}`
                  : 'PDF page'
              }
            />
            <canvas
              ref={overlayCanvasRef}
              onPointerDown={onOverlayPointerDown}
              onPointerMove={onOverlayPointerMove}
              onPointerLeave={onOverlayPointerLeave}
              className={cn(
                'absolute left-0 top-0 block touch-none',
                tool !== 'select' && 'cursor-crosshair'
              )}
              aria-hidden="true"
            />
          </div>
        </div>

        {loadState !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-sm text-brand-text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-brand-navy" />
              {loadState === 'fetching' && 'Looking up file…'}
              {loadState === 'opening' && 'Opening PDF…'}
              {loadState === 'rendering' && 'Rendering page…'}
            </div>
          </div>
        )}

        {/* Calibration form — non-modal floating panel, mirrors the
            toolbar on the right side of the canvas area. Plan stays
            fully visible so contractors can reference existing scale
            annotations (e.g. "SCALE: 3/32\" = 1'0\"" in title blocks)
            while entering their real-world distance. Opens 250ms
            after the second calibration click. */}
        <CalibrationPanel
          open={showCalibrationModal}
          onClose={handleCalibrationCancel}
          onSubmit={handleCalibrationSubmit}
          pdfDistance={calibrationPdfDistance}
        />

        {/* Count session panel — visible whenever the user is in count
            mode AND the label modal isn't up yet. Mirrors the
            CalibrationPanel positioning. */}
        <CountPanel
          open={
            tool === 'count' &&
            (countDraft === null || countDraft.status === 'collecting')
          }
          count={countDraft?.points.length ?? 0}
          onFinish={handleCountFinish}
          onCancel={handleCountCancel}
        />

        {/* Area session panel — same positioning + state pattern as
            CountPanel. Finish gated on ≥3 vertices internally. */}
        <AreaPanel
          open={
            tool === 'area' &&
            (areaDraft === null || areaDraft.status === 'collecting')
          }
          vertexCount={areaDraft?.points.length ?? 0}
          onFinish={handleAreaFinish}
          onCancel={handleAreaCancel}
        />

        {/* Polyline session panel — Finish button gives open polyline;
            clicking first vertex closes (handled in onPointerDown). */}
        <PolylinePanel
          open={
            tool === 'freehand' &&
            (polylineDraft === null || polylineDraft.status === 'collecting')
          }
          vertexCount={polylineDraft?.points.length ?? 0}
          onFinish={handleFreehandFinish}
          onCancel={handleFreehandCancel}
        />
        </div>

        {/* Sidebar (right) */}
        <MeasureSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          pageNumber={pageNumber}
          pageScale={pageScale}
          workAreas={workAreas}
          defaultWorkAreaId={defaultWorkAreaId}
          onDefaultWorkAreaChange={setDefaultWorkAreaId}
          measurements={getMeasurementsForPage(measurements, pageNumber)}
          selectedId={selectedId}
          onSelectMeasurement={setSelectedId}
          onDeleteMeasurement={requestDeleteMeasurement}
        />
      </div>

      {/* Count label modal — opens after the user clicks Finish in
          CountPanel. Real modal (backdrop + center) because the form
          is pure text entry; no plan reference needed underneath.
          Cancel / X / Esc all fully discard the count session. */}
      <CountLabelModal
        open={countDraft?.status === 'awaiting_label'}
        count={countDraft?.points.length ?? 0}
        onSubmit={handleCountSubmitLabel}
        onClose={handleCountCancel}
      />

      {/* Area label modal — same pattern as CountLabelModal. Header
          shows pre-computed area string from the same live-state
          recompute the canvas uses for rendering. */}
      <AreaLabelModal
        open={areaDraft?.status === 'awaiting_label'}
        areaDisplay={areaDraftDisplay}
        onSubmit={handleAreaSubmitLabel}
        onClose={handleAreaCancel}
      />

      {/* Polyline label modal — header dynamic on open vs closed. */}
      <PolylineLabelModal
        open={polylineDraft?.status === 'awaiting_label'}
        closed={polylineDisplay.closed}
        perimeterDisplay={polylineDisplay.perim}
        areaDisplay={polylineDisplay.area}
        onSubmit={handleFreehandSubmitLabel}
        onClose={handleFreehandCancel}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete this measurement?"
        description={
          deleteTarget ? (
            <>
              The measurement{' '}
              <strong className="text-brand-text">
                {describeMeasurementForDelete(deleteTarget, pageScale)}
              </strong>{' '}
              will be permanently removed.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
