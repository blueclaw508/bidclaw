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

export type MeasurementToolType =
  | 'line'
  | 'area'
  | 'count'
  | 'freehand_polyline'
  | 'freehand_drag'

/**
 * `points` shape is per-tool and lives entirely in JSONB. Phase 4+ will
 * define discriminated-union types for each tool's `points`. For Phase 1
 * we type it as `unknown` so nothing depends on a shape we haven't
 * locked in yet.
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
