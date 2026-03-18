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

  // KYN: Labor Burden
  base_hourly_wage: number | null
  payroll_tax_rate: number
  workers_comp_rate: number
  pto_days_per_year: number
  unbillable_percent: number
  burdened_labor_cost: number | null
  true_cost_per_billable_hour: number | null

  // KYN: Overhead
  monthly_overhead: Record<string, number> | null
  annual_overhead: number | null
  annual_billable_hours: number | null
  overhead_per_hour: number | null

  // KYN: Profit & Retail Rate
  target_profit_percent: number
  retail_labor_rate: number | null

  // KYN: Markups
  material_markup_percent: number
  sub_markup_percent: number
  disposal_markup_percent: number
  delivery_markup_percent: number

  // KYN: Efficiency
  prior_year_sales: number | null
  prior_year_materials: number | null
  prior_year_subs: number | null
  prior_year_avg_hourly_rate: number | null
  prior_year_paid_hours: number | null
  prior_year_material_markup: number | null
  prior_year_sub_markup: number | null
  efficiency_rating: number | null

  kyn_setup_complete: boolean
  created_at: string
}

// ── KYN Overhead Categories ──
export const OVERHEAD_CATEGORIES = [
  { key: 'owner_salary', label: 'Owner/Manager Salary' },
  { key: 'office_staff', label: 'Office Staff' },
  { key: 'office_rent', label: 'Office Rent/Utilities' },
  { key: 'vehicle_payments', label: 'Vehicle Payments/Leases' },
  { key: 'fuel', label: 'Fuel (non-job)' },
  { key: 'equipment_payments', label: 'Equipment Payments' },
  { key: 'general_liability', label: 'General Liability Insurance' },
  { key: 'business_insurance', label: 'Business Insurance' },
  { key: 'advertising', label: 'Advertising/Marketing' },
  { key: 'accounting_legal', label: 'Accounting/Legal Fees' },
  { key: 'software', label: 'Software Subscriptions' },
  { key: 'phone', label: 'Phone/Communications' },
  { key: 'tools_supplies', label: 'Tools & Supplies (non-job)' },
  { key: 'workers_comp_overhead', label: 'Workers Comp (overhead portion)' },
  { key: 'health_insurance', label: 'Group Health Insurance' },
  { key: 'retirement', label: 'Retirement Matching' },
  { key: 'recruiting', label: 'Recruiting' },
  { key: 'training', label: 'Training & Education' },
  { key: 'bad_debt', label: 'Bad Debt' },
  { key: 'bank_fees', label: 'Bank & Merchant Fees' },
  { key: 'other', label: 'Other Expenses' },
] as const

// ── KYN Production Rate Benchmarks ──
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
