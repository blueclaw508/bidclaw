import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { getDocument } from '@/lib/pdfjs'
import type { PDFDocumentProxy, RenderTask } from '@/lib/pdfjs'
import { CalibrationPanel } from '@/components/measure/CalibrationPanel'
import { MeasureToolbar } from '@/components/measure/MeasureToolbar'
import {
  computeScaleFactor,
  distanceBetweenPoints,
  distancePointToSegment,
  getMeasurementsForPage,
  parseLinePoints,
  pdfPageToCanvas,
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
 * Phase 3 enables Select (Phase 2) + Calibrate (Phase 3). Others
 * render disabled with "coming in Phase X" tooltips.
 */
const PHASE3_ENABLED_TOOLS: readonly MeasureToolMode[] = ['select', 'calibrate']

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

  // Switching pages should also drop any in-progress calibration draft
  // — points are PDF-page-units and would carry over invisibly to the
  // new page. Same reasoning as the selection clear.
  useEffect(() => {
    setCalibrationDraft({ points: [] })
    setSelectedId(null)
  }, [pageNumber])

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
  }, [renderInfo, measurements, selectedId, pageNumber, calibrationDraft])

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
      if (calibrationDraft.points.length > 0) {
        setCalibrationDraft({ points: [] })
        setTool('select')
        return
      }
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calibrationDraft.points.length])

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

      if (tool !== 'select') {
        // Phase 4+ wires line/count/area/freehand creation here.
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
        }
      }
      // null when click was on canvas but > HIT_THRESHOLD from any
      // measurement — that's the deselect path.
      setSelectedId(hit)
    },
    [renderInfo, tool, measurements, pageNumber, calibrationDraft.points.length]
  )

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

        {/* Phase 3 status strip — calibration state for the current page.
            Sits between filename and the page navigator. Compact so the
            sub-header still works on narrow widths. */}
        {file && (
          <div className="shrink-0">
            {pageScale ? (
              <div
                className="flex items-center gap-1.5 rounded-md bg-brand-surface px-2 py-1 text-xs"
                title={`Scale: ${pageScale.real_world_distance} ${pageScale.real_world_unit} per ${distanceBetweenPoints(
                  (pageScale.calibration_points as Point[])[0] ?? { x: 0, y: 0 },
                  (pageScale.calibration_points as Point[])[1] ?? { x: 0, y: 0 }
                ).toFixed(2)} PDF units`}
              >
                <span className="font-semibold text-brand-navy">Scale:</span>
                <span className="tabular-nums text-brand-text">
                  {pageScale.real_world_distance} {pageScale.real_world_unit}
                </span>
              </div>
            ) : (
              <div className="rounded-md border border-brand-gold/40 bg-brand-gold-pale px-2 py-1 text-xs font-semibold text-brand-gold-dark">
                Not calibrated
              </div>
            )}
          </div>
        )}

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

      {/* Canvas area */}
      <div className="relative min-h-[300px] rounded-xl border border-brand-border bg-white p-3 shadow-sm">
        {/* Floating tool toolbar — anchored top-left of the canvas area.
            Z above the canvas so it stays interactive when canvases are
            tall enough to scroll under it. */}
        <div className="absolute left-5 top-5 z-10">
          <MeasureToolbar
            tool={tool}
            onChange={setTool}
            enabledTools={PHASE3_ENABLED_TOOLS}
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
      </div>
    </div>
  )
}
