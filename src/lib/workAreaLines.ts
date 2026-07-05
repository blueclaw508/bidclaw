// Data layer for work_area_lines — the LIVE estimate lines that live
// ON work areas (estimate-first rework, R2; migration 0013).
//
// Semantics differ from proposal_lines on purpose:
//   • INSTANT SAVE — every mutation writes immediately (QC model);
//     there is no draft/dirty/Save-bar state at this layer.
//   • LIVE numbers — unit_cost is the BASE cost; billed price is
//     computed at render from current settings markup (see
//     estimateLineTotal in @/lib/money). Nothing here is frozen.
//   • No editability guard — estimates are always editable; the
//     freeze happens at proposal GENERATION (R4).
//
// Conventions match the rest of src/lib: throw on error, RLS scopes
// rows to the current user (two-hop through work_areas → projects).

import { supabase } from '@/lib/supabase'
import type { ProposalLineCategory, WorkAreaLine } from '@/lib/types'

export type { WorkAreaLine }

/**
 * Add a line to a work area. `sortOrder` comes from the caller (which
 * holds the WA's current lines and appends max+1) to avoid a read
 * round-trip on every add — adds happen in bursts from the catalog
 * modal.
 */
export async function addWorkAreaLine(input: {
  workAreaId: string
  category: ProposalLineCategory
  label: string
  unit: string
  quantity: number
  unitCost: number
  sortOrder: number
  catalogItemId?: string | null
  sourceKitId?: string | null
}): Promise<WorkAreaLine> {
  const { data, error } = await supabase
    .from('work_area_lines')
    .insert({
      work_area_id: input.workAreaId,
      category: input.category,
      label: input.label,
      unit: input.unit,
      quantity: input.quantity,
      unit_cost: input.unitCost,
      price_override: null,
      catalog_item_id: input.catalogItemId ?? null,
      source_kit_id: input.sourceKitId ?? null,
      sort_order: input.sortOrder,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't add line: ${error?.message ?? 'no row returned'}`)
  }
  return data as WorkAreaLine
}

/**
 * Patch a line (instant save — called per field commit). Allowed
 * fields: label, unit, quantity, unit_cost, price_override, markup_override,
 * sort_order. price_override / markup_override: number sets it, null clears
 * it (back to the company live markup).
 */
export async function updateWorkAreaLine(
  id: string,
  patch: Partial<
    Pick<
      WorkAreaLine,
      | 'label'
      | 'unit'
      | 'quantity'
      | 'unit_cost'
      | 'price_override'
      | 'markup_override'
      | 'sort_order'
    >
  >
): Promise<WorkAreaLine> {
  const { data, error } = await supabase
    .from('work_area_lines')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save line: ${error?.message ?? 'no row returned'}`)
  }
  return data as WorkAreaLine
}

/** Delete a line (instant, no confirm — QC model). */
export async function deleteWorkAreaLine(id: string): Promise<void> {
  const { error } = await supabase.from('work_area_lines').delete().eq('id', id)
  if (error) throw new Error(`Couldn't delete line: ${error.message}`)
}

/**
 * Bulk insert (kit → estimate, R3). One INSERT for the whole batch;
 * sort orders are assigned by the caller starting after its current
 * max. Returns the created rows in insert order.
 */
export async function addWorkAreaLinesBulk(
  rows: Array<{
    workAreaId: string
    category: ProposalLineCategory
    label: string
    unit: string
    quantity: number
    unitCost: number
    sortOrder: number
    catalogItemId?: string | null
    sourceKitId?: string | null
  }>
): Promise<WorkAreaLine[]> {
  if (rows.length === 0) return []
  const { data, error } = await supabase
    .from('work_area_lines')
    .insert(
      rows.map((r) => ({
        work_area_id: r.workAreaId,
        category: r.category,
        label: r.label,
        unit: r.unit,
        quantity: r.quantity,
        unit_cost: r.unitCost,
        price_override: null,
        catalog_item_id: r.catalogItemId ?? null,
        source_kit_id: r.sourceKitId ?? null,
        sort_order: r.sortOrder,
      }))
    )
    .select()
  if (error || !data) {
    throw new Error(`Couldn't add kit lines: ${error?.message ?? 'no rows returned'}`)
  }
  return data as WorkAreaLine[]
}

/**
 * Rewrite sort_order for the supplied ids in order (drag-reorder, R3).
 * Skips rows already in position. Estimate lines are single-writer
 * instant-save rows — per-row updates are fine here.
 */
export async function reorderWorkAreaLines(
  orderedIds: string[],
  currentSortById: Record<string, number>
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      currentSortById[id] === idx
        ? Promise.resolve({ error: null })
        : supabase.from('work_area_lines').update({ sort_order: idx }).eq('id', id)
    )
  )
  const firstErr = results.find((r) => r.error)
  if (firstErr?.error) {
    throw new Error(`Reorder failed: ${firstErr.error.message}`)
  }
}
