import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A drawn signature. Pointer events cover mouse, touch, and pen; the
 * canvas is scaled to devicePixelRatio so a phone signature is not a
 * blurry one. Reports a PNG data URL whenever the drawing changes, and
 * null when cleared or empty.
 */
export function SignaturePad({
  onChange,
  disabled = false,
  height = 160,
}: {
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  // Size the bitmap to the element × DPR. Re-run on resize so a rotated
  // phone does not stretch the strokes; drawing is cleared on resize,
  // which is the honest outcome — a stretched signature is not theirs.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111827'
      hasInk.current = false
      setEmpty(true)
      onChange(null)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    return () => ro.disconnect()
    // onChange is stable from the parent (useCallback); resizing must not
    // re-run for a new function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const emit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(hasInk.current ? canvas.toDataURL('image/png') : null)
  }, [onChange])

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    const p = point(e)
    if (!ctx || !last.current) return
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!hasInk.current) {
      hasInk.current = true
      setEmpty(false)
    }
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    // A tap with no movement still leaves a dot, so the signature is not
    // silently blank after a very short stroke.
    const ctx = e.currentTarget.getContext('2d')
    if (ctx && last.current && !hasInk.current) {
      ctx.beginPath()
      ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2)
      ctx.fillStyle = '#111827'
      ctx.fill()
      hasInk.current = true
      setEmpty(false)
    }
    drawing.current = false
    last.current = null
    emit()
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    hasInk.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className={`w-full rounded-lg border-2 border-dashed bg-white ${
            disabled ? 'cursor-not-allowed border-gray-200' : 'cursor-crosshair border-gray-400'
          }`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
          aria-label="Signature"
        />
        {empty && (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-gray-400">
            Sign here with your finger or mouse
          </span>
        )}
      </div>
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
