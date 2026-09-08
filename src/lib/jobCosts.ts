import { supabase } from '@/lib/supabase'
import { lineBase, lineTotal, roundMoney, sumMoney } from '@/lib/money'
import type { JobCost, JobCostCategory, ProposalLineCategory } from '@/lib/types'

/* ============================================================
 * Job costs (migration 0047) — data layer.
 * ============================================================ */

export const COST_CATEGORY_ORDER: JobCostCategory[] = ['labor', 'material', 'equipment', 'subcontractor', 'other']
export const COST_CATEGORY_LABELS: Record<JobCostCategory, string> = {
  labor: 'Labor',
  material: 'Materials',
  equipment: 'Equipment',
  subcontractor: 'Subcontractors',
  other: 'Other',
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function shape(r: Record<string, unknown>): JobCost {
  return { ...(r as unknown as JobCost), amount: num(r.amount) }
}

export async function listJobCostsByProject(projectId: string): Promise<JobCost[]> {
  const { data, error } = await supabase
    .from('job_costs')
    .select('*')
    .eq('project_id', projectId)
    .order('txn_date', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(shape)
}

/** Pulled lines for this customer that landed on no project. */
export async function listUnassignedCostsForCustomer(customerId: string): Promise<JobCost[]> {
  const { data, error } = await supabase
    .from('job_costs')
    .select('*')
    .eq('customer_id', customerId)
    .is('project_id', null)
    .order('txn_date', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(shape)
}

export async function assignJobCost(id: string, projectId: string | null): Promise<void> {
  const { error } = await supabase.from('job_costs').update({ project_id: projectId }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setJobCostCategory(id: string, category: JobCostCategory): Promise<void> {
  const { error } = await supabase.from('job_costs').update({ category }).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ---------- the estimate side ---------- */

export interface CostSummary {
  /** Which proposal the estimate came from, and whether it is approved. */
  proposal: { id: string; name: string; status: string } | null
  contract: number
  estimated: Record<JobCostCategory, number>
  actual: Record<JobCostCategory, number>
  estimatedTotal: number
  actualTotal: number
}

const zero = (): Record<JobCostCategory, number> => ({ labor: 0, material: 0, equipment: 0, subcontractor: 0, other: 0 })

/**
 * Estimated COST by category from the project's approved proposal (or its
 * latest proposal when none is approved), against actual cost pulled from
 * QuickBooks. Estimated cost is quantity × frozen unit cost — the number
 * before markup — because that is what a bill compares to.
 */
export async function projectCostSummary(projectId: string): Promise<CostSummary> {
  const { data: proposals, error } = await supabase
    .from('proposals')
    .select('id, name, status, updated_at, proposal_work_areas ( enabled, proposal_lines ( category, quantity, frozen_unit_cost, frozen_markup_percent, price_override ) )')
    .eq('project_id', projectId)
  if (error) throw new Error(error.message)
  type Raw = {
    id: string
    name: string
    status: string
    updated_at: string
    proposal_work_areas: Array<{
      enabled: boolean
      proposal_lines: Array<{
        category: ProposalLineCategory
        quantity: number
        frozen_unit_cost: number
        frozen_markup_percent: number
        price_override: number | null
      }>
    }>
  }
  const all = (proposals ?? []) as Raw[]
  const rank = (s: string) => (s === 'approved' || s === 'in_progress' || s === 'completed' ? 2 : s === 'lost' ? 0 : 1)
  const chosen = all.slice().sort((a, b) => rank(b.status) - rank(a.status) || b.updated_at.localeCompare(a.updated_at))[0] ?? null

  const estimated = zero()
  let contract = 0
  if (chosen) {
    for (const wa of chosen.proposal_work_areas) {
      if (!wa.enabled) continue
      for (const l of wa.proposal_lines) {
        estimated[l.category] = roundMoney(estimated[l.category] + lineBase(l))
        contract = roundMoney(contract + lineTotal(l))
      }
    }
  }

  const costs = await listJobCostsByProject(projectId)
  const actual = zero()
  for (const c of costs) actual[c.category] = roundMoney(actual[c.category] + c.amount)

  return {
    proposal: chosen ? { id: chosen.id, name: chosen.name, status: chosen.status } : null,
    contract,
    estimated,
    actual,
    estimatedTotal: sumMoney(Object.values(estimated)),
    actualTotal: sumMoney(Object.values(actual)),
  }
}

/** Cost-to-cost percent complete for a project: actual ÷ estimated cost, capped at 100. */
export async function costToCostPercent(projectId: string): Promise<number | null> {
  const s = await projectCostSummary(projectId)
  if (s.estimatedTotal <= 0) return null
  return Math.min(100, roundMoney((s.actualTotal / s.estimatedTotal) * 100))
}
