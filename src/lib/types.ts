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
