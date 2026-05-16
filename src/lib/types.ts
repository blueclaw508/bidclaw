// Phase-1 schema mirror. Keep these in sync with
// supabase/migrations/0001_phase1_foundation.sql.
// We're intentionally NOT using generated Supabase types yet — Phase 1
// is small enough that hand-rolled types are clearer to read and easier
// to evolve. Revisit when the schema gets too big to track manually.

export type ProjectStatus =
  | 'draft'
  | 'estimating'
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'complete'
  | 'lost'
  | 'archived'

export type WorkAreaStatus = 'draft' | 'approved' | 'in_progress' | 'complete'

export type CatalogCategory =
  | 'labor'
  | 'material'
  | 'equipment'
  | 'disposal'
  | 'design'
  | 'other'

export type ProjectFileType =
  | 'original_plan'
  | 'measured_plan'
  | 'crew_budget'
  | 'customer_proposal'
  | 'signed_proposal'
  | 'invoice'
  | 'change_order'
  | 'other'

export interface Project {
  id: string
  user_id: string
  customer_id: string | null
  name: string
  status: ProjectStatus
  site_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  user_id: string
  name: string
  email: string | null
  phone: string | null
  billing_address: string | null
  site_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WorkArea {
  id: string
  project_id: string
  name: string
  description: string | null
  sequence_order: number
  status: WorkAreaStatus
  created_at: string
  updated_at: string
}

export interface CatalogItem {
  id: string
  user_id: string
  name: string
  description: string | null
  unit: string
  category: CatalogCategory
  unit_cost: number
  markup_percent: number
  needs_pricing: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  file_type: ProjectFileType
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  version_number: number
  uploaded_at: string
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Measurements (manual measuring tool — Phase 1 Prompt 3)
// ──────────────────────────────────────────────────────────────────────
// The `measurements` table lands in 0001_phase1_foundation.sql but we
// don't read/write rows until Phase 4 (the line tool). Defined here in
// Phase 1 so MeasureView typing stays clean as later phases land.

/**
 * DB-persisted tool discriminator. Mirrors the CHECK constraint in
 * 0001_phase1_foundation.sql.
 *
 * NOT the same as MeasureToolMode below — the toolbar has a 'select'
 * mode that is purely a UI state and never reaches the database.
 */
export type MeasurementToolType =
  | 'line'
  | 'area'
  | 'count'
  | 'freehand_polyline'
  | 'freehand_drag'

/**
 * Toolbar mode in the measure UI. Includes 'select' (the pointer/idle
 * state) which has no DB representation; 'freehand' covers both
 * persistence variants (the disambiguation between freehand_polyline
 * and freehand_drag happens at commit time, Phase 7).
 */
export type MeasureToolMode =
  | 'select'
  | 'line'
  | 'count'
  | 'area'
  | 'freehand'

/** A point in any coordinate space. See measureCoords.ts for which space. */
export interface Point {
  x: number
  y: number
}

/** Two-point line measurement payload — stored in PDF page units. */
export type LinePoints = readonly [Point, Point]

/**
 * Snapshot of the PDF render state, set once per page render by
 * MeasureView. The overlay canvas + hit-test + render effect all depend
 * on this — single source of truth so PDF and overlay can't desync.
 */
export interface RenderInfo {
  /** Base PDF page width in PDF user units (typically 72 dpi). */
  pdfWidth: number
  /** Base PDF page height in PDF user units. */
  pdfHeight: number
  /** CSS px per PDF unit. fitScale × pdfWidth = canvas CSS width. */
  fitScale: number
  /** Device pixel ratio used for the canvas backing store (capped at 2). */
  dpr: number
}

/**
 * `points` shape is per-tool and lives in a JSONB column. We type the
 * row's `points` as `unknown` and narrow per-tool via the parser
 * helpers in measureCoords.ts (parseLinePoints, etc.). That keeps the
 * row type simple and pushes shape validation to a single boundary.
 */
export interface Measurement {
  id: string
  project_id: string
  work_area_id: string | null
  tool_type: MeasurementToolType
  label: string | null
  points: unknown
  pdf_page_number: number
  source_file_id: string | null
  calculated_value: number | null
  calculated_unit: string | null
  scale_factor: number
  created_at: string
  updated_at: string
}
