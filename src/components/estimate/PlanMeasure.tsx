// Click-to-Measure Plan Tool — Tier 1
// Canvas overlay for measuring areas and distances on uploaded plan images
// Supports: scale calibration, rectangle, polygon, and linear tools

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Ruler,
  Square,
  Pentagon,
  Minus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  Move,
} from 'lucide-react'

// ── Types ──

export interface MeasurePoint {
  x: number
  y: number
}

export interface Measurement {
  id: string
  type: 'rectangle' | 'polygon' | 'linear'
  points: MeasurePoint[]
  label: string
  value: number // SF for area, LF for linear
  unit: 'SF' | 'LF'
}

export interface ScaleCalibration {
  pixelDistance: number
  realDistance: number // in feet
  unit: 'ft'
}

type Tool = 'pan' | 'scale' | 'rectangle' | 'polygon' | 'linear'

interface PlanMeasureProps {
  imageUrl: string
  measurements: Measurement[]
  onMeasurementsChange: (measurements: Measurement[]) => void
  onClose: () => void
}

// ── Helpers ──

function distance(a: MeasurePoint, b: MeasurePoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

function polygonArea(pts: MeasurePoint[]): number {
  // Shoelace formula
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y
    area -= pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

// ── Component ──

export function PlanMeasure({ imageUrl, measurements, onMeasurementsChange, onClose }: PlanMeasureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const [tool, setTool] = useState<Tool>('pan')
  const [scale, setScale] = useState<ScaleCalibration | null>(null)
  const [scaleInput, setScaleInput] = useState('')
  const [scalePoints, setScalePoints] = useState<MeasurePoint[]>([])

  const [currentPoints, setCurrentPoints] = useState<MeasurePoint[]>([])
  const [mousePos, setMousePos] = useState<MeasurePoint | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [showLabelModal, setShowLabelModal] = useState(false)
  const [pendingMeasurement, setPendingMeasurement] = useState<Omit<Measurement, 'id' | 'label'> | null>(null)

  // Pan & zoom
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  const [imgLoaded, setImgLoaded] = useState(false)

  // Load image
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
      // Fit image to container
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth
        const ch = containerRef.current.clientHeight
        const fitZoom = Math.min(cw / img.width, ch / img.height, 1)
        setZoom(fitZoom)
        setOffset({
          x: (cw - img.width * fitZoom) / 2,
          y: (ch - img.height * fitZoom) / 2,
        })
      }
    }
    img.src = imageUrl
  }, [imageUrl])

  // Convert screen coordinates to image coordinates
  const screenToImage = useCallback(
    (sx: number, sy: number): MeasurePoint => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (sx - rect.left - offset.x) / zoom,
        y: (sy - rect.top - offset.y) / zoom,
      }
    },
    [offset, zoom],
  )

  // Convert image coordinates to screen coordinates
  const imageToScreen = useCallback(
    (pt: MeasurePoint): MeasurePoint => ({
      x: pt.x * zoom + offset.x,
      y: pt.y * zoom + offset.y,
    }),
    [offset, zoom],
  )

  // Pixel distance → real feet
  const pixelsToFeet = useCallback(
    (px: number): number => {
      if (!scale || scale.pixelDistance === 0) return 0
      return (px / scale.pixelDistance) * scale.realDistance
    },
    [scale],
  )

  // Draw everything
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imgRef.current
    if (!canvas || !ctx || !img || !imgLoaded) return

    const cw = canvas.width
    const ch = canvas.height
    ctx.clearRect(0, 0, cw, ch)

    // Draw image
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)
    ctx.drawImage(img, 0, 0)
    ctx.restore()

    // Draw completed measurements
    for (const m of measurements) {
      drawMeasurement(ctx, m, false)
    }

    // Draw current in-progress points
    if (currentPoints.length > 0) {
      drawInProgress(ctx)
    }

    // Draw scale calibration points
    if (scalePoints.length > 0 && tool === 'scale') {
      drawScalePoints(ctx)
    }
  }, [imgLoaded, offset, zoom, measurements, currentPoints, mousePos, scalePoints, tool])

  function drawMeasurement(ctx: CanvasRenderingContext2D, m: Measurement, _highlight: boolean) {
    const pts = m.points.map(imageToScreen)
    ctx.strokeStyle = '#2563EB'
    ctx.fillStyle = 'rgba(37, 99, 235, 0.1)'
    ctx.lineWidth = 2

    if (m.type === 'rectangle' && pts.length === 2) {
      const [a, b] = pts
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    } else if (m.type === 'polygon' && pts.length >= 3) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (m.type === 'linear' && pts.length === 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[1].x, pts[1].y)
      ctx.stroke()
    }

    // Draw vertices
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#2563EB'
      ctx.fill()
    }

    // Label
    if (pts.length >= 2) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const text = `${m.label}: ${m.value.toFixed(1)} ${m.unit}`
      ctx.font = 'bold 12px Inter, system-ui, sans-serif'
      const tw = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillRect(cx - tw / 2 - 4, cy - 8, tw + 8, 18)
      ctx.fillStyle = '#1e3a8a'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, cy)
    }
  }

  function drawInProgress(ctx: CanvasRenderingContext2D) {
    const pts = currentPoints.map(imageToScreen)
    const mouse = mousePos ? imageToScreen(mousePos) : null

    ctx.strokeStyle = '#d4a843'
    ctx.fillStyle = 'rgba(212, 168, 67, 0.15)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])

    if (tool === 'rectangle' && pts.length === 1 && mouse) {
      ctx.strokeRect(pts[0].x, pts[0].y, mouse.x - pts[0].x, mouse.y - pts[0].y)
      ctx.fillRect(pts[0].x, pts[0].y, mouse.x - pts[0].x, mouse.y - pts[0].y)
    } else if (tool === 'polygon') {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      if (mouse) ctx.lineTo(mouse.x, mouse.y)
      if (pts.length >= 3) ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (tool === 'linear' && pts.length === 1 && mouse) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(mouse.x, mouse.y)
      ctx.stroke()
    }

    ctx.setLineDash([])

    // Draw vertices
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#d4a843'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Live dimension preview
    if (scale && mouse && pts.length > 0) {
      const lastPt = pts[pts.length - 1]
      if (tool === 'linear' || tool === 'rectangle') {
        const pxDist = distance(
          currentPoints[currentPoints.length - 1],
          mousePos!,
        )
        const ft = pixelsToFeet(pxDist)
        const midX = (lastPt.x + mouse.x) / 2
        const midY = (lastPt.y + mouse.y) / 2
        ctx.font = 'bold 11px Inter, system-ui, sans-serif'
        const text = `${ft.toFixed(1)} ft`
        const tw = ctx.measureText(text).width
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(midX - tw / 2 - 3, midY - 16, tw + 6, 16)
        ctx.fillStyle = '#fff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, midX, midY - 8)
      }
    }
  }

  function drawScalePoints(ctx: CanvasRenderingContext2D) {
    const pts = scalePoints.map(imageToScreen)
    const mouse = mousePos ? imageToScreen(mousePos) : null

    ctx.strokeStyle = '#10B981'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])

    if (pts.length === 1 && mouse) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(mouse.x, mouse.y)
      ctx.stroke()
    } else if (pts.length === 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[1].x, pts[1].y)
      ctx.stroke()
    }

    ctx.setLineDash([])
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#10B981'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  // Redraw on state changes
  useEffect(() => { draw() }, [draw])

  // Resize canvas
  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      draw()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [draw])

  // ── Event Handlers ──

  function handleCanvasClick(e: React.MouseEvent) {
    if (tool === 'pan') return
    const pt = screenToImage(e.clientX, e.clientY)

    if (tool === 'scale') {
      const newPts = [...scalePoints, pt]
      setScalePoints(newPts)
      if (newPts.length === 2) {
        // Ask for real distance
        const pxDist = distance(newPts[0], newPts[1])
        const input = prompt('Enter the real-world distance between these two points (in feet):')
        if (input) {
          const realDist = parseFloat(input)
          if (realDist > 0) {
            setScale({ pixelDistance: pxDist, realDistance: realDist, unit: 'ft' })
          }
        }
        setScalePoints([])
        setTool('pan')
      }
      return
    }

    if (!scale) {
      alert('Set scale first — click the ruler icon and mark a known distance on the plan.')
      return
    }

    if (tool === 'rectangle') {
      const newPts = [...currentPoints, pt]
      setCurrentPoints(newPts)
      if (newPts.length === 2) {
        const w = pixelsToFeet(Math.abs(newPts[1].x - newPts[0].x))
        const h = pixelsToFeet(Math.abs(newPts[1].y - newPts[0].y))
        const sf = w * h
        setPendingMeasurement({ type: 'rectangle', points: newPts, value: sf, unit: 'SF' })
        setShowLabelModal(true)
        setCurrentPoints([])
      }
    } else if (tool === 'linear') {
      const newPts = [...currentPoints, pt]
      setCurrentPoints(newPts)
      if (newPts.length === 2) {
        const lf = pixelsToFeet(distance(newPts[0], newPts[1]))
        setPendingMeasurement({ type: 'linear', points: newPts, value: lf, unit: 'LF' })
        setShowLabelModal(true)
        setCurrentPoints([])
      }
    } else if (tool === 'polygon') {
      // Check if clicking near first point to close
      if (currentPoints.length >= 3) {
        const firstScreen = imageToScreen(currentPoints[0])
        const clickScreen = { x: e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0), y: e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0) }
        if (distance(firstScreen, clickScreen) < 15) {
          // Close polygon
          const areaPx = polygonArea(currentPoints)
          const scaleFactor = scale ? (scale.realDistance / scale.pixelDistance) ** 2 : 1
          const sf = areaPx * scaleFactor
          setPendingMeasurement({ type: 'polygon', points: [...currentPoints], value: sf, unit: 'SF' })
          setShowLabelModal(true)
          setCurrentPoints([])
          return
        }
      }
      setCurrentPoints([...currentPoints, pt])
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const pt = screenToImage(e.clientX, e.clientY)
    setMousePos(pt)

    if (isPanning) {
      setOffset({
        x: offset.x + (e.clientX - panStart.x),
        y: offset.y + (e.clientY - panStart.y),
      })
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (tool === 'pan' || e.button === 1) {
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      e.preventDefault()
    }
  }

  function handleMouseUp() {
    setIsPanning(false)
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const newZoom = Math.max(0.1, Math.min(5, zoom * factor))

    // Zoom toward cursor
    setOffset({
      x: mx - (mx - offset.x) * (newZoom / zoom),
      y: my - (my - offset.y) * (newZoom / zoom),
    })
    setZoom(newZoom)
  }

  function saveMeasurement() {
    if (!pendingMeasurement || !labelInput.trim()) return
    const m: Measurement = {
      ...pendingMeasurement,
      id: 'meas_' + Date.now(),
      label: labelInput.trim(),
    }
    onMeasurementsChange([...measurements, m])
    setPendingMeasurement(null)
    setLabelInput('')
    setShowLabelModal(false)
  }

  function deleteMeasurement(id: string) {
    onMeasurementsChange(measurements.filter((m) => m.id !== id))
  }

  function resetView() {
    if (imgRef.current && containerRef.current) {
      const cw = containerRef.current.clientWidth
      const ch = containerRef.current.clientHeight
      const fitZoom = Math.min(cw / imgRef.current.width, ch / imgRef.current.height, 1)
      setZoom(fitZoom)
      setOffset({
        x: (cw - imgRef.current.width * fitZoom) / 2,
        y: (ch - imgRef.current.height * fitZoom) / 2,
      })
    }
  }

  const tools: { id: Tool; icon: typeof Ruler; label: string; shortcut: string }[] = [
    { id: 'pan', icon: Move, label: 'Pan', shortcut: 'V' },
    { id: 'scale', icon: Ruler, label: 'Set Scale', shortcut: 'S' },
    { id: 'rectangle', icon: Square, label: 'Rectangle (SF)', shortcut: 'R' },
    { id: 'polygon', icon: Pentagon, label: 'Polygon (SF)', shortcut: 'P' },
    { id: 'linear', icon: Minus, label: 'Linear (LF)', shortcut: 'L' },
  ]

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (showLabelModal) return
      const key = e.key.toLowerCase()
      if (key === 'v') setTool('pan')
      else if (key === 's') setTool('scale')
      else if (key === 'r') setTool('rectangle')
      else if (key === 'p') setTool('polygon')
      else if (key === 'l') setTool('linear')
      else if (key === 'escape') {
        setCurrentPoints([])
        setScalePoints([])
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showLabelModal])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2">
        <div className="flex items-center gap-1">
          {tools.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => { setTool(t.id); setCurrentPoints([]); setScalePoints([]) }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tool === t.id
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
                title={`${t.label} (${t.shortcut})`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {scale && (
            <span className="rounded-md bg-emerald-900/50 px-2 py-1 text-[10px] font-medium text-emerald-300">
              Scale: 1px = {(scale.realDistance / scale.pixelDistance).toFixed(4)} ft
            </span>
          )}
          <button onClick={() => setZoom(Math.min(5, zoom * 1.2))} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white">
            <ZoomIn size={16} />
          </button>
          <span className="text-xs text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.max(0.1, zoom / 1.2))} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white">
            <ZoomOut size={16} />
          </button>
          <button onClick={resetView} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white" title="Reset view">
            <RotateCcw size={16} />
          </button>
          <div className="mx-2 h-6 w-px bg-slate-700" />
          <button
            onClick={onClose}
            className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
          >
            <X size={14} className="inline mr-1" />
            Close
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            className={`h-full w-full ${
              tool === 'pan' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
            }`}
          />
        </div>

        {/* Measurements sidebar */}
        <div className="w-64 border-l border-slate-700 bg-slate-800 overflow-y-auto">
          <div className="p-3">
            <h3 className="mb-3 text-sm font-semibold text-white">Measurements</h3>

            {!scale && (
              <div className="mb-3 rounded-lg border border-amber-800/50 bg-amber-900/30 p-3">
                <p className="text-xs text-amber-300">
                  Set scale first: click the <strong>Set Scale</strong> tool, mark two points on a known dimension, then enter the distance.
                </p>
              </div>
            )}

            {measurements.length === 0 ? (
              <p className="text-xs text-slate-500">No measurements yet.</p>
            ) : (
              <div className="space-y-2">
                {measurements.map((m) => (
                  <div key={m.id} className="flex items-start justify-between rounded-lg bg-slate-700/50 p-2.5">
                    <div>
                      <p className="text-xs font-medium text-white">{m.label}</p>
                      <p className="text-[10px] text-slate-400">
                        {m.value.toFixed(1)} {m.unit}
                        <span className="ml-1 text-slate-500">({m.type})</span>
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMeasurement(m.id)}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}

                {/* Totals */}
                <div className="border-t border-slate-700 pt-2">
                  {(() => {
                    const totalSF = measurements.filter((m) => m.unit === 'SF').reduce((s, m) => s + m.value, 0)
                    const totalLF = measurements.filter((m) => m.unit === 'LF').reduce((s, m) => s + m.value, 0)
                    return (
                      <>
                        {totalSF > 0 && (
                          <p className="text-xs font-medium text-emerald-400">Total Area: {totalSF.toFixed(1)} SF</p>
                        )}
                        {totalLF > 0 && (
                          <p className="text-xs font-medium text-sky-400">Total Length: {totalLF.toFixed(1)} LF</p>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="border-t border-slate-700 bg-slate-800 px-4 py-1.5">
        <p className="text-[10px] text-slate-500">
          {tool === 'pan' && 'Click and drag to pan. Scroll to zoom.'}
          {tool === 'scale' && (scalePoints.length === 0 ? 'Click the first point of a known dimension.' : 'Click the second point.')}
          {tool === 'rectangle' && (currentPoints.length === 0 ? 'Click the first corner.' : 'Click the opposite corner.')}
          {tool === 'polygon' && (currentPoints.length === 0 ? 'Click to start the polygon.' : `${currentPoints.length} points — click near the first point to close. Press Escape to cancel.`)}
          {tool === 'linear' && (currentPoints.length === 0 ? 'Click the start point.' : 'Click the end point.')}
        </p>
      </div>

      {/* Label modal */}
      {showLabelModal && pendingMeasurement && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Name this measurement</h3>
            <p className="mb-3 text-xs text-slate-500">
              {pendingMeasurement.value.toFixed(1)} {pendingMeasurement.unit} ({pendingMeasurement.type})
            </p>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveMeasurement()}
              placeholder="e.g. Front Walkway, Patio Area"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowLabelModal(false); setPendingMeasurement(null); setLabelInput('') }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveMeasurement}
                disabled={!labelInput.trim()}
                className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                <Check size={12} className="inline mr-1" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
