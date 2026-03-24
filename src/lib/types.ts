// ============================================================
// BidClaw Types — Spec-aligned
// QuickCalc owns: auth, company profile, catalogs
// BidClaw owns: estimates, work areas, line items, production rates
// ============================================================

// ── QuickCalc Types (read from kyn_user_settings + kyn_catalog_items) ──

export interface QCCompanyProfile {
  companyName: string
  userName: string
  companyAddress: string
  companyEmail: string
  companyWebsite: string
  companyPhone: string
  companyLogoBase64: string
}

export interface QCSettings {
  laborTypes: { id: string; name: string; targetBillableRate: number }[]
  materialsMarkupPercent: number
  subcontractorsMarkupPercent: number
  equipmentRates: { id: string; name: string; hourlyRate: number }[]
  companyProfile: QCCompanyProfile
  pdfBranding: { primaryColor: string; footerMessage: string }
  defaultTermsAndConditions: string
}

export type CatalogCategory = 'Materials' | 'Subcontractors' | 'Equipment' | 'Disposal' | 'Labor'
export type CatalogSource = 'manual' | 'bidclaw_auto'

export interface CatalogItem {
  id: string
  user_id: string
  type: string
  name: string
  labor_type_id: string | null
  unit_cost: number | null
  equipment_rate_id: string | null
  sub_cost: number | null
  default_amount: number | null
  source: CatalogSource
  needs_pricing: boolean
  created_at: string
  updated_at: string
}

// ── BidClaw Production Rates (spec Section 6, Tab 3) ──

export interface ProductionRate {
  id: string
  user_id: string
  task_name: string
  unit: string
  crew_size: number
  hours_per_unit: number
  notes: string | null
  created_at: string
  updated_at: string
}

// ── BidClaw Estimates (spec Section 9) ──

export type ApprovalStatus = 'draft' | 'work_areas_approved' | 'line_items_approved' | 'sent'

export interface WorkAreaData {
  id: string
  name: string
  description: string
  complexity: 'Simple' | 'Moderate' | 'Complex'
  approved: boolean
  crew_size?: number
  crew_hours_per_day?: number
  line_items?: LineItemData[]
  // Embedded scope and gap questions (saved inside work_areas JSON column)
  scope_description?: string
  gap_questions?: string[]
}

export type LineItemCategory = 'Materials' | 'Labor' | 'Equipment' | 'Subcontractor' | 'Disposal'
export type LineItemUnit = 'SF' | 'LF' | 'CY' | 'SY' | 'EA' | 'LS' | 'HR' | 'Day' | 'Allow'

export interface LineItemData {
  id: string
  name: string
  quantity: number
  unit: LineItemUnit | string
  category: LineItemCategory
  description: string
  catalog_match_type?: 'matched' | 'fuzzy_matched' | 'new_created'
  catalog_item_id?: string
  unit_cost?: number | null
}

export interface EstimateRecord {
  id: string
  user_id: string
  client_name: string | null
  project_name: string | null
  project_address: string | null
  project_description: string | null
  plan_file_urls: string[]
  workflow_step: number
  work_areas: WorkAreaData[] | null
  line_items: Record<string, LineItemData[]> | null
  new_catalog_items_created: string[] | null
  approval_status: ApprovalStatus
  sent_to_quickcalc_at: string | null
  created_at: string
  updated_at: string
}

// ── AI Response Types ──

export interface AiWorkArea {
  id: string
  name: string
  description: string
  complexity: 'Simple' | 'Moderate' | 'Complex'
  gap_questions?: string[]
}

export interface AiPass1Response {
  work_areas: AiWorkArea[]
}

export interface AiLineItem {
  id: string
  name: string
  quantity: number
  unit: string
  category: LineItemCategory
  description: string
}

export interface AiPass2WorkArea {
  id: string
  name: string
  scope_description: string
  line_items: AiLineItem[]
  gap_questions: string[]
  new_catalog_items: string[]
}

export interface AiPass2Response {
  work_areas: AiPass2WorkArea[]
}

// ── Legacy types (kept for backward compat) ──

export type EstimateStatus = 'draft' | 'approved' | 'sent_to_quickcalc'
export type SpecSource = 'plan' | 'site_visit'

export interface Estimate {
  id: string
  user_id: string
  client_name: string
  client_email: string | null
  client_phone: string | null
  job_address: string | null
  job_city: string | null
  job_state: string | null
  job_zip: string | null
  spec_source: SpecSource
  plan_url: string | null
  status: EstimateStatus
  ai_conversation: { role: string; content: string }[] | null
  created_at: string
  updated_at: string
}

export interface WorkArea {
  id: string
  estimate_id: string
  name: string
  sort_order: number
  ai_generated: boolean
  approved: boolean
  notes: string[]
  total_man_hours: number | null
  crew_size: number
  crew_hours_per_day: number
  day_increment: string | null
}

export type LineItemType = 'material' | 'equipment' | 'labor' | 'sub' | 'disposal' | 'general_conditions'

export interface LineItem {
  id: string
  work_area_id: string
  type: LineItemType
  name: string
  quantity: number
  unit: string | null
  ai_generated: boolean
  sort_order: number
}

export interface JobEfficiency {
  id: string
  estimate_id: string
  budgeted_man_hours: number
  actual_man_hours: number | null
  efficiency_percent: number | null
  notes: string | null
  tracked_at: string
}

export interface QuickCalcPayload {
  source: 'bidclaw'
  estimate: {
    client_name: string
    client_email: string | null
    client_phone: string | null
    job_address: string | null
    date: string
    work_areas: {
      name: string
      sort_order: number
      notes: string[]
      materials: { name: string; quantity: number; unit: string }[]
      equipment: { name: string; hours: number }[]
      labor: { man_hours: number; crew_size: number; crew_hours_per_day: number; days: number }
      general_conditions: number
    }[]
    man_hour_summary: {
      total_man_hours: number
      total_days: number
    }
  }
}

export const PRODUCTION_RATE_DEFAULTS: Omit<ProductionRate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  { task_name: 'Sod Installation', unit: 'SF', crew_size: 2, hours_per_unit: 0.02, notes: null },
  { task_name: 'Mulch Spreading', unit: 'CY', crew_size: 2, hours_per_unit: 0.5, notes: null },
  { task_name: 'Paver Installation', unit: 'SF', crew_size: 3, hours_per_unit: 0.1, notes: null },
  { task_name: 'Retaining Wall Block', unit: 'SF face', crew_size: 3, hours_per_unit: 0.25, notes: null },
  { task_name: 'Edging (steel)', unit: 'LF', crew_size: 1, hours_per_unit: 0.05, notes: null },
  { task_name: 'Grading / Finish Grade', unit: 'SY', crew_size: 2, hours_per_unit: 0.15, notes: null },
]

export function roundManHours(manHours: number, crewSize: number, hoursPerDay: number): number {
  const crewDay = crewSize * hoursPerDay
  if (crewDay <= 0) return manHours
  return Math.ceil(manHours / crewDay) * crewDay
}
