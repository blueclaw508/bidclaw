// Pure coordinate math for the measure tool.
//
// THREE COORDINATE SPACES — these names appear everywhere in the
// measure-tool code, treat them as a fixed vocabulary:
//
//   1. Screen px        — what pointer events give us (event.clientX/Y).
//                         Origin = top-left of the browser viewport.
//   2. CSS canvas px    — pixel space inside the overlay/PDF canvas as
//                         the CSS box reports it. Origin = canvas top-left.
//                         Hit-testing, selection thresholds, and on-screen
//                         "feel" all live in this space.
//   3. PDF page units   — the PDF's own coordinate system (typically 72 dpi).
//                         INVARIANT across zoom, DPR, and resize — so
//                         persisted measurements are stored in this space.
//
// DPR never appears in these helpers. It only matters when DRAWING to a
// canvas backing store: in that path we set `ctx.scale(dpr, dpr)` once and
// then all draw calls use CSS coords. Keeping DPR out of the coord layer
// keeps the math testable and the call sites readable.

import type {
  LinePoints,
  Measurement,
  Point,
  RenderInfo,
} from '@/lib/types'

// ──────────────────────────────────────────────────────────────────────
// Coordinate transforms
// ──────────────────────────────────────────────────────────────────────

/** Screen px (event.clientX/Y) → CSS canvas px. */
export function screenToCanvas(p: Point, canvasRect: DOMRect): Point {
  return { x: p.x - canvasRect.left, y: p.y - canvasRect.top }
}

/** CSS canvas px → PDF page units (the invariant storage space). */
export function canvasToPdfPage(p: Point, fitScale: number): Point {
  return { x: p.x / fitScale, y: p.y / fitScale }
}

/** PDF page units → CSS canvas px (use at render time). */
export function pdfPageToCanvas(p: Point, fitScale: number): Point {
  return { x: p.x * fitScale, y: p.y * fitScale }
}

/** Composite: screen px straight to PDF page units. */
export function screenToPdfPage(
  p: Point,
  canvasRect: DOMRect,
  fitScale: number
): Point {
  return canvasToPdfPage(screenToCanvas(p, canvasRect), fitScale)
}

// ──────────────────────────────────────────────────────────────────────
// Geometry helpers — Euclidean distance + perpendicular point-to-segment.
// Inputs must all be in the SAME coord space; the result is in that
// space. Hit-testing uses point-to-segment in CSS canvas px space;
// calibration uses point-to-point in PDF page units.
// ──────────────────────────────────────────────────────────────────────

/** Euclidean distance between two points. */
export function distanceBetweenPoints(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Midpoint of two points (any coord space). Used to anchor line labels. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Compute the scale_factor for a calibration: how many real-world
 * units each PDF unit represents.
 *
 *   scale_factor = real_world_distance ÷ |p2 − p1|   (p1, p2 in PDF units)
 *
 * To convert a PDF distance D back to real-world: D × scale_factor.
 * Throws if the two points are identical (zero-length calibration).
 */
export function computeScaleFactor(
  p1: Point,
  p2: Point,
  realWorldDistance: number
): number {
  const pdfDistance = distanceBetweenPoints(p1, p2)
  if (pdfDistance === 0) {
    throw new Error('Calibration points must be distinct (zero distance)')
  }
  return realWorldDistance / pdfDistance
}

export function distancePointToSegment(
  p: Point,
  a: Point,
  b: Point
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    // Degenerate (zero-length) segment — distance to point a.
    const dpx = p.x - a.x
    const dpy = p.y - a.y
    return Math.sqrt(dpx * dpx + dpy * dpy)
  }
  // Project p onto AB, clamp parametric t to the segment.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const closestX = a.x + t * dx
  const closestY = a.y + t * dy
  const distX = p.x - closestX
  const distY = p.y - closestY
  return Math.sqrt(distX * distX + distY * distY)
}

// ──────────────────────────────────────────────────────────────────────
// Defensive parsers — JSONB columns are `unknown` to TS, and a hand-
// edited DB row could put anything in `points`. Parsers return null on
// malformed data so the renderer can skip it without throwing.
// ──────────────────────────────────────────────────────────────────────

function isPoint(v: unknown): v is Point {
  if (typeof v !== 'object' || v === null) return false
  const pt = v as { x?: unknown; y?: unknown }
  return (
    typeof pt.x === 'number' &&
    typeof pt.y === 'number' &&
    Number.isFinite(pt.x) &&
    Number.isFinite(pt.y)
  )
}

/** Parse `points` for a line-tool measurement. Returns null if malformed. */
export function parseLinePoints(raw: unknown): LinePoints | null {
  if (!Array.isArray(raw)) return null
  if (raw.length !== 2) return null
  const [a, b] = raw
  if (!isPoint(a) || !isPoint(b)) return null
  return [a, b] as const
}

/**
 * Parse `points` for a count-tool measurement — any non-empty array of
 * points. Returns null if malformed (empty array, non-array, bad point
 * shapes). Marker numbering is array-index + 1, so order matters.
 */
export function parseCountPoints(raw: unknown): readonly Point[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length === 0) return null
  for (const p of raw) {
    if (!isPoint(p)) return null
  }
  return raw as readonly Point[]
}

/**
 * True if point p is within `radius` of `center`. All three inputs
 * must be in the SAME coord space (count hit-test uses CSS canvas px).
 */
export function pointInCircle(p: Point, center: Point, radius: number): boolean {
  const dx = p.x - center.x
  const dy = p.y - center.y
  return dx * dx + dy * dy <= radius * radius
}

// ──────────────────────────────────────────────────────────────────────
// Page filtering helper — called in TWO places (render effect and
// hit-test handler). Centralized so the filter rule can't drift
// between them.
// ──────────────────────────────────────────────────────────────────────

export function getMeasurementsForPage(
  measurements: readonly Measurement[],
  pageNumber: number
): Measurement[] {
  return measurements.filter((m) => m.pdf_page_number === pageNumber)
}

// Re-export RenderInfo for consumers that want to type a function that
// takes a render snapshot. (It lives in types.ts because Phase 4+ will
// reference it from outside the measure-tool subdir.)
export type { RenderInfo }
