import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getDocument } from '@/lib/pdfjs'
import type { PDFDocumentProxy, RenderTask } from '@/lib/pdfjs'
import type { ProjectFile } from '@/lib/types'

/**
 * Phase 1 of the manual measuring tool: render a project PDF onto a
 * single canvas with page navigation. No drawing, no scale, no
 * measurements — Phase 2+ layers an overlay canvas on top of this and
 * Phases 3–7 add the actual tools.
 *
 * Lives inside AppShell (per approved plan): /app/projects/:projectId/measure/:fileId
 */

type LoadState = 'fetching' | 'opening' | 'rendering' | 'ready' | 'error'

export default function MeasureView() {
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>()
  const navigate = useNavigate()

  const [file, setFile] = useState<ProjectFile | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('fetching')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)

  const measureRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const backTo = projectId ? `/app/projects/${projectId}` : '/app/projects'

  // ──────────────────────────────────────────────────────────────────
  // 1. Fetch file row → validate → download bytes → parse with pdfjs.
  //    Doing the whole download upfront (instead of letting pdfjs
  //    range-request) means we don't have to worry about the 60-second
  //    signed-URL expiring mid-session. Plan PDFs are capped at 50 MB
  //    by the upload modal, so memory cost is bounded.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !fileId) return

    let cancelled = false
    // Track the doc this run produced so the cleanup can destroy it
    // even before setDoc has flushed to state.
    let docToDestroy: PDFDocumentProxy | null = null

    async function load() {
      setLoadState('fetching')
      setErrorMessage(null)
      setDoc(null)
      setPageCount(0)
      setPageNumber(1)
      setFile(null)

      // RLS will return zero rows for files this user can't see, which
      // looks identical to "doesn't exist". That's the right UX too —
      // don't leak whether a fileId is real for some other user.
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
      // URL says projectId X but the file row says project_id Y →
      // someone hand-edited the URL. Same error message as the RLS
      // case: don't leak which side mismatched.
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

      // Short-lived signed URL just to GET the bytes. Once we have the
      // ArrayBuffer, pdfjs holds them in worker memory — URL can expire.
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
          // Effect was cancelled while we were parsing — drop the doc
          // immediately to release worker memory.
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
  // 2. Track the rendering container's width via ResizeObserver so
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
  // 3. Render the current page to canvas. Re-runs on doc/page/width
  //    changes. Cancels any in-flight render task on change/unmount so
  //    rapid page-flips don't pile up.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc || containerWidth === 0) return
    let cancelled = false

    async function render() {
      // Cancel any in-flight render (rapid page nav)
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

      const canvas = canvasRef.current
      if (!canvas) return

      const base = page.getViewport({ scale: 1 })
      const fitScale = containerWidth / base.width
      // Cap DPR at 2 — beyond that canvas memory blows up with marginal
      // visual gain (and many high-DPR phones already report 3+).
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: fitScale * dpr })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(fitScale * base.width)}px`
      canvas.style.height = `${Math.floor(fitScale * base.height)}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // pdfjs v5 requires `canvas` (not just `canvasContext`) for the
      // OffscreenCanvas / accessibility-on-canvas path. Both must point
      // at the same element.
      const task = page.render({ canvasContext: ctx, viewport, canvas })
      renderTaskRef.current = task

      try {
        await task.promise
        if (!cancelled) setLoadState('ready')
      } catch (err) {
        // Cancellation throws a named exception in pdfjs — that's the
        // expected path when the user flips pages mid-render, NOT an
        // error to surface.
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
        {/* measureRef sits inside the padding so containerWidth is the
            actual available canvas width (parent.clientWidth - 2*12px). */}
        <div ref={measureRef}>
          <canvas
            ref={canvasRef}
            className="mx-auto block bg-white"
            aria-label={
              file?.file_name
                ? `Page ${pageNumber} of ${file.file_name}`
                : 'PDF page'
            }
          />
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
      </div>
    </div>
  )
}
