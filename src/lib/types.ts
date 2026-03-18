// ── Company ──
export interface Company {
  id: string
  user_id: string
  name: string
  logo_url: string | null
  address: string | null
  crew_full_day_men: number
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

// ── Material Catalog ──
export interface MaterialCatalogItem {
  id: string
  company_id: string
  name: string
  unit: string
  unit_cost: number
  supplier: string | null
  notes: string | null
}

// ── Sub Catalog ──
export interface SubCatalogItem {
  id: string
  company_id: string
  name: string
  unit: string
  unit_cost: number
  trade: string | null
  notes: string | null
}

// ── Equipment ──
export interface EquipmentItem {
  id: string
  company_id: string
  name: string
  billable: boolean
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
export type LineItemType = 'material' | 'equipment' | 'labor' | 'sub' | 'general_conditions'

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
