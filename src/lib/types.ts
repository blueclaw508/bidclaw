// ── Company ──
// BidClaw collects quantities only. No pricing, markups, or KYN fields.
export interface Company {
  id: string
  user_id: string
  name: string
  logo_url: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  typical_crew_size: number
  crew_full_day_hours: number
  crew_half_day_hours: number
  estimating_methodology: string | null
  created_at: string
}

// ── Production Rates ──
export interface ProductionRate {
  id: string
  company_id: string
  work_type: string
  unit: string
  man_hours_per_unit: number
  notes: string | null
}

// ── Item Catalog — Materials ──
export interface MaterialCatalogItem {
  id: string
  company_id: string
  name: string
  um: string | null
  unit: string
  unit_cost: number
  supplier: string | null
  notes: string | null
}

// ── Item Catalog — Subcontractors ──
export interface SubCatalogItem {
  id: string
  company_id: string
  name: string
  um: string | null
  unit: string
  unit_cost: number
  trade: string | null
  notes: string | null
}

// ── Item Catalog — Equipment (names only, no rates) ──
export interface EquipmentItem {
  id: string
  company_id: string
  name: string
  billable: boolean
}

// ── Item Catalog — Disposal Fees/Other ──
export interface DisposalCatalogItem {
  id: string
  company_id: string
  name: string
  um: string | null
  unit: string
  unit_cost: number
  notes: string | null
}

// ── Work Types ──
export interface WorkType {
  id: string
  company_id: string
  name: string
  category: string
  default_notes_template: string | null
}

// ── Estimates ──
export type EstimateStatus = 'draft' | 'approved' | 'sent_to_quickcalc'
export type SpecSource = 'plan' | 'site_visit'

export interface Estimate {
  id: string
  company_id: string
  client_name: string
  client_email: string | null
  job_address: string | null
  job_city: string | null
  job_state: string | null
  job_zip: string | null
  spec_source: SpecSource
  plan_url: string | null
  status: EstimateStatus
  ai_conversation: AiMessage[] | null
  created_at: string
  updated_at: string
}

// ── Work Areas ──
export interface WorkArea {
  id: string
  estimate_id: string
  name: string
  sort_order: number
  ai_generated: boolean
  approved: boolean
  notes: string[]
  total_man_hours: number | null
  day_increment: 'full' | 'half' | null
}

// ── Line Items ──
export type LineItemType = 'material' | 'equipment' | 'labor' | 'sub' | 'disposal' | 'general_conditions'

export interface LineItem {
  id: string
  work_area_id: string
  type: LineItemType
  name: string
  quantity: number
  unit: string | null
  unit_cost: number | null
  total_cost: number | null
  ai_generated: boolean
  sort_order: number
}

// ── Job Efficiency ──
export interface JobEfficiency {
  id: string
  estimate_id: string
  budgeted_man_hours: number
  actual_man_hours: number | null
  efficiency_percent: number | null
  notes: string | null
  tracked_at: string
}

// ── AI Response Types ──
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiWorkAreaProposal {
  name: string
  category: string
  rationale: string
}

export interface AiPlanAnalysis {
  work_areas: AiWorkAreaProposal[]
  assumptions: string[]
  questions: string[]
}

export interface AiTakeoffMaterial {
  name: string
  quantity: number
  unit: string
  unit_cost: number
  rationale: string
}

export interface AiTakeoffEquipment {
  name: string
  hours: number
}

export interface AiTakeoffWorkArea {
  name: string
  materials: AiTakeoffMaterial[]
  equipment: AiTakeoffEquipment[]
  assumptions: string[]
}

export interface AiTakeoffResponse {
  work_areas: AiTakeoffWorkArea[]
}

export interface AiFullEstimateWorkArea {
  name: string
  notes: string[]
  materials: AiTakeoffMaterial[]
  equipment: AiTakeoffEquipment[]
  labor: {
    man_hours: number
    increment: 'full' | 'half'
    days: number
  }
  general_conditions: { amount: number }
}

export interface AiFullEstimateResponse {
  work_areas: AiFullEstimateWorkArea[]
  man_hour_summary: {
    total_man_hours: number
    total_days: number
    breakdown: { work_area: string; man_hours: number; days: number }[]
  }
}

// ── QuickCalc Payload ──
export interface QuickCalcPayload {
  source: 'bidclaw'
  estimate: {
    client_name: string
    client_email: string | null
    job_address: string | null
    date: string
    work_areas: {
      name: string
      sort_order: number
      notes: string[]
      materials: { name: string; quantity: number; unit: string; unit_cost: number }[]
      equipment: { name: string; hours: number }[]
      labor: { man_hours: number; increment: string; days: number }
      general_conditions: number
    }[]
    man_hour_summary: {
      total_man_hours: number
      total_days: number
    }
  }
}

// ── Production Rate Benchmarks ──
export const PRODUCTION_BENCHMARKS = [
  { work_type: 'Mulch Install', unit: 'CY', bca_rate: 1.5, verified: true },
  { work_type: 'Loam Spread & Grade', unit: 'CY', bca_rate: null, verified: false },
  { work_type: 'Sod Installation', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Hydroseeding', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Paver Patio (full)', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Natural Stone Patio', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Retaining Wall (block)', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Fieldstone/Veneer Wall', unit: 'SF', bca_rate: null, verified: false },
  { work_type: 'Plant Install (5 gal)', unit: 'EA', bca_rate: null, verified: false },
  { work_type: 'Plant Install (B&B)', unit: 'EA', bca_rate: null, verified: false },
  { work_type: 'Mulch Bed Edging', unit: 'LF', bca_rate: null, verified: false },
  { work_type: 'Spring Cleanup', unit: 'HR', bca_rate: 1.0, verified: true },
] as const
