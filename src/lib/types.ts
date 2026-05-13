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

export type LineItemCategory = 'Materials' | 'Labor' | 'Equipment' | 'Subcontractor' | 'Disposal' | 'Other'
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
  placeholder?: boolean
  placeholder_note?: string
}

// ── Jamie Mode Detection (Change B) ──

export type WorkAreaEstimateMode = 'full_takeoff' | 'needs_info' | 'allowance'

export interface GapQuestion {
  question: string
  type: 'select' | 'single_select' | 'number' | 'text'
  options?: string[]
  unit?: string
  required: boolean
  answer?: string | number
  allow_custom?: boolean
  custom_unit?: string
  id?: string
}

export interface EstimateRecord {
  id: string
  user_id: string
  client_name: string | null
  project_name: string | null
  project_address: string | null
  project_description: string | null
  plan_file_urls: string[]
  plan_measurements: any[] | null  // Measurement[] from PlanMeasure
  plan_scale: any | null           // ScaleCalibration from PlanMeasure
  workflow_step: number
  work_areas: WorkAreaData[] | null
  line_items: Record<string, LineItemData[]> | null
  scope_descriptions: Record<string, string> | null
  gap_questions: Record<string, string[]> | null
  structured_gap_questions?: Record<string, GapQuestion[]> | null
  work_area_modes?: Record<string, WorkAreaEstimateMode> | null
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
  mode: WorkAreaEstimateMode
  scope_description: string
  line_items: AiLineItem[]
  gap_questions: string[]
  structured_gap_questions?: GapQuestion[]
  new_catalog_items: string[]
}

export interface AiPass2Response {
  work_areas: AiPass2WorkArea[]
}

// Single work area response (used by isolated per-work-area API calls)
export interface AiPass2SingleWorkAreaResponse {
  id: string
  name: string
  mode: WorkAreaEstimateMode
  plan_references?: string[]
  jamie_message?: string
  scope_description: string
  line_items: AiLineItem[]
  gap_questions: string[]
  structured_gap_questions?: GapQuestion[]
  new_catalog_items: string[]
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

// ============================================================
// V2 Types — BidClaw Rebuild (April 2026)
// Maps 1:1 to new relational schema (estimates + work_areas +
// line_items + measurements tables). Old types above are
// preserved for backward compat during the rebuild.
// ============================================================

// ── Estimate Status (V2 flow) ──

export type V2EstimateStatus =
  | 'draft'
  | 'pass1_complete'
  | 'estimating'
  | 'review'
  | 'sent'
  | 'exported'

// ── Plan File (stored in estimates.plans JSONB array) ──

export interface V2PlanFile {
  file_path: string
  file_name: string
  page_count: number
  rasterized_pages: string[]   // URLs to individual page images
  uploaded_at: string
}

// ── Pass 1 Extraction (stored in estimates.pass1_extraction JSONB) ──

export interface V2Pass1Dimension {
  item: string
  value: string
  unit: string
  calculated_area?: number
}

export interface V2Pass1Material {
  item: string
  spec: string
  location: string
}

export interface V2Pass1Quantity {
  item: string
  count: number
  size?: string
}

export interface V2Pass1Annotation {
  text: string
  location: string
}

export interface V2Pass1AreaZone {
  name: string
  approx_sf: number
  notes?: string
}

export interface V2Pass1ExistingCondition {
  item: string
  note: string
}

export interface V2Pass1Unknown {
  item: string
  note: string
}

export type V2Pass1Confidence = 'high' | 'medium' | 'low'

export interface V2Pass1Extraction {
  plans_analyzed: number
  confidence: V2Pass1Confidence

  // Raw extraction (nested under "extraction" in v3, flattened for compat)
  dimensions: V2Pass1Dimension[]
  materials: V2Pass1Material[]
  quantities: V2Pass1Quantity[]
  annotations: V2Pass1Annotation[]
  areas_zones: V2Pass1AreaZone[]
  existing_conditions: V2Pass1ExistingCondition[]
  scale: string | null
  unknowns: V2Pass1Unknown[]

  // v3 additions — Jamie proposes work areas + asks questions + extracts client info
  proposed_work_areas?: V2Pass1ProposedWorkArea[]
  questions?: V2Pass1Question[]
  client_info_found?: V2Pass1ClientInfo
}

// ── v3 Pass 1 — Proposed Work Areas ──

export interface V2Pass1ProposedWorkArea {
  name: string
  summary: string
  relevant_extraction: string[]
  confidence: V2Pass1Confidence
}

// ── v3 Pass 1 — Dynamic Questions ──

export interface V2Pass1Question {
  question: string
  options?: string[]
  allow_custom?: boolean
  relates_to_work_area?: string
  answer?: string
}

// ── v3 Pass 1 — Client Info Found on Plans ──

export interface V2Pass1ClientInfo {
  address?: string | null
  city?: string | null
  state?: string | null
  client_name?: string | null
  project_name?: string | null
  notes?: string | null
}

// ── Estimates Table (V2 — new columns added to existing table) ──

export interface V2Estimate {
  id: string
  user_id: string
  created_at: string
  updated_at: string

  // Customer info (1:1 with QuickCalc)
  first_name: string
  last_name: string
  company_name: string | null
  phone: string | null
  email: string | null

  // Project info
  estimate_name: string | null
  address_line: string
  city: string
  state: string
  zip: string
  project_type: string | null
  project_description: string | null

  // Plan data
  plans: V2PlanFile[] | null

  // Pass 1 output
  pass1_extraction: V2Pass1Extraction | null
  pass1_confidence: V2Pass1Confidence | null
  pass1_completed_at: string | null

  // Status
  status: V2EstimateStatus
}

// ── Work Areas Table ──

export type V2Pass2Mode = 'mode1' | 'mode2'

export interface V2GapQuestion {
  question: string
  answer?: string
  answered_at?: string
}

export interface V2WorkArea {
  id: string
  estimate_id: string
  name: string
  sort_order: number
  created_at: string

  // Pass 2 output
  scope_description: string | null
  pass2_mode: V2Pass2Mode | null
  pass2_raw: Record<string, unknown> | null
  gap_questions: V2GapQuestion[] | null
  pass2_completed_at: string | null
}

// ── Line Items Table ──

export type V2LineItemCategory =
  | 'Materials'
  | 'Equipment'
  | 'Labor'
  | 'Subcontractor'
  | 'Other'

export type V2MatchStatus = 'exact' | 'fuzzy' | 'new' | 'manual'
export type V2LineItemSource = 'jamie' | 'user_added' | 'user_edited'

export interface V2LineItem {
  id: string
  work_area_id: string
  estimate_id: string
  sort_order: number
  created_at: string

  // Item data
  name: string
  qty: number
  unit: string
  category: V2LineItemCategory

  // Catalog matching
  catalog_item_id: string | null
  match_status: V2MatchStatus | null

  // Source tracking
  source: V2LineItemSource
  original_name: string | null
}

// ── Measurements Table ──

export type V2MeasurementShape = 'rectangle' | 'polygon' | 'linear'

export interface V2MeasurementVertex {
  x: number
  y: number
}

export interface V2Measurement {
  id: string
  estimate_id: string
  work_area_id: string | null
  plan_index: number | null
  created_at: string

  // Measurement data
  name: string | null
  shape: V2MeasurementShape | null
  area_sf: number | null
  linear_ft: number | null
  length_ft: number | null
  width_ft: number | null
  vertices: V2MeasurementVertex[] | null
  scale_ppi: number | null
}

// ── Pass 2 API Response (what Jamie returns per work area) ──

export interface V2Pass2Response {
  work_area: string
  scope_description: string
  line_items: {
    name: string
    qty: number
    unit: string
    category: V2LineItemCategory
    catalog_item_id: string | null
    match_status: V2MatchStatus
  }[]
  reasoning?: string
  gap_questions: string[]
  new_catalog_items: string[]
}

// ── QuickCalc Push Payload (V2 — no cost fields) ──

export interface V2QuickCalcPayload {
  // Customer info (1:1 with QC fields)
  first_name: string
  last_name: string
  company_name: string | null
  phone: string | null
  email: string | null
  estimate_name: string | null
  address_line: string
  city: string
  state: string
  zip: string
  project_description: string | null

  // Work areas with line items
  work_areas: {
    name: string
    scope_description: string | null
    line_items: {
      catalog_item_id: string | null
      name: string
      qty: number
      unit: string
      category: V2LineItemCategory
      // NO cost, price, rate, or amount fields — ever
    }[]
  }[]
}
