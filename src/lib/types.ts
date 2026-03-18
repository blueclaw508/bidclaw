// ============================================================
// BidClaw Types — Reads from QuickCalc's Supabase
// QuickCalc owns: auth, company profile, catalogs, settings
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

export interface QCUserSettings {
  id: string
  user_id: string
  settings_data: QCSettings
  created_at: string
  updated_at: string
}

export type QCCatalogItemType = 'labor' | 'material' | 'subcontractor' | 'equipment' | 'other'

export interface QCCatalogItem {
  id: string
  user_id: string
  type: QCCatalogItemType
  name: string
  labor_type_id: string | null
  unit_cost: number | null
  equipment_rate_id: string | null
  sub_cost: number | null
  default_amount: number | null
  created_at: string
  updated_at: string
}

// ── BidClaw Types (own tables, prefixed with bidclaw_) ──

export interface ProductionRate {
  id: string
  user_id: string
  work_type: string
  unit: string
  man_hours_per_unit: number
  notes: string | null
}

export interface DisposalCatalogItem {
  id: string
  user_id: string
  name: string
  um: string | null
}

export interface WorkType {
  id: string
  user_id: string
  name: string
  category: string
  default_notes_template: string | null
}

export type EstimateStatus = 'draft' | 'approved' | 'sent_to_quickcalc'
export type SpecSource = 'plan' | 'site_visit'

export interface Estimate {
  id: string
  user_id: string
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
    crew_size: number
    crew_hours_per_day: number
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

// ── Round man hours to nearest crew-day ──
export function roundManHours(manHours: number, crewSize: number, hoursPerDay: number): number {
  const crewDay = crewSize * hoursPerDay
  if (crewDay <= 0) return manHours
  return Math.ceil(manHours / crewDay) * crewDay
}
