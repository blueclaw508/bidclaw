// Data layer for the proposals + proposal_lines tables. All Proposal
// pages (Prompt 6+) read/write through these functions — no direct
// supabase calls in components.
//
// Conventions match companySettings.ts + kits.ts:
//   • Throw on error (callers handle with toast / state)
//   • RLS scopes queries to the current user — no explicit user_id filter
//   • Pricing snapshot is FROZEN at insert; never recomputed from live
//     settings/catalog state (Q3a from Prompt 5 carry-forward)
//
// Five decisions locked at start of Prompt 6 — encoded throughout:
//   1. Hand-rolled types in src/lib/types.ts (matches Prompts 1–5)
//   2. 'Other' kit_line.type → 'other' category. Markup uses
//      markup_subs_percent until a dedicated markup_other_percent
//      is added (additive Phase 1.5 schema change).
//   3. reference_missing lines block previewKitLines() entirely.
//   4. NULL-factor / factor=0 lines surface as placeholder: true
//      with quantity: 0. Commits with quantity=0 are silently
//      filtered at insert.
//   5. frozen_unit_cost is canonical for ALL calculation.
//      frozen_labor_rate + frozen_equipment_rate are pure audit
//      fields — getProposalTotals never reads them.

import { supabase } from '@/lib/supabase'
import { loadKit, resolveKitLineReference } from '@/lib/kits'
import type {
  KitPreviewLine,
  Proposal,
  ProposalLine,
  ProposalLineCategory,
  ProposalStatus,
  ProposalWithLines,
} from '@/lib/types'

// Re-export the core types so callers can `import { Proposal } from '@/lib/proposals'`.
export type {
  KitPreviewLine,
  Proposal,
  ProposalLine,
  ProposalLineCategory,
  ProposalStatus,
  ProposalWithLines,
}

// ──────────────────────────────────────────────────────────────────────
// Editability helper
// ──────────────────────────────────────────────────────────────────────

/**
 * Single source of truth for "can this proposal still be edited?" —
 * applied at the guard rail of every line-mutating function and at
 * updateProposal() for content-vs-status distinction.
 */
export function isProposalEditable(status: ProposalStatus): boolean {
  return status === 'draft'
}

// ──────────────────────────────────────────────────────────────────────
// Proposal CRUD
// ──────────────────────────────────────────────────────────────────────

export async function listProposalsByProject(projectId: string): Promise<Proposal[]> {
  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    throw new Error(`Couldn't load proposals: ${error.message}`)
  }
  return (data ?? []) as Proposal[]
}

/**
 * Load a proposal + its ordered line items. Throws on RLS / network
 * failure; returns null for a missing/RLS-hidden id (matches loadKit
 * convention from Prompt 5).
 */
export async function getProposal(id: string): Promise<ProposalWithLines | null> {
  const [{ data: prop, error: pErr }, { data: lines, error: lErr }] = await Promise.all([
    supabase.from('proposals').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('proposal_lines')
      .select('*')
      .eq('proposal_id', id)
      .order('sort_order', { ascending: true }),
  ])
  if (pErr) throw new Error(`Couldn't load proposal: ${pErr.message}`)
  if (!prop) return null
  if (lErr) throw new Error(`Couldn't load proposal lines: ${lErr.message}`)
  return { ...(prop as Proposal), lines: (lines ?? []) as ProposalLine[] }
}

export async function createProposal(input: {
  projectId: string
  workAreaId: string
  name: string
}): Promise<Proposal> {
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      project_id: input.projectId,
      work_area_id: input.workAreaId,
      name: input.name.trim(),
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't create proposal: ${error?.message ?? 'no row returned'}`)
  }
  return data as Proposal
}

/**
 * Patch a proposal header. Editability guard: once status !== 'draft',
 * only the `status` field may be patched (status transitions allowed;
 * content edits blocked).
 */
export async function updateProposal(
  id: string,
  patch: Partial<Pick<Proposal, 'name' | 'notes' | 'status'>>
): Promise<Proposal> {
  const { data: current, error: lookupErr } = await supabase
    .from('proposals')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !current) {
    throw new Error(
      `Couldn't load proposal for update: ${lookupErr?.message ?? 'not found'}`
    )
  }
  if (!isProposalEditable(current.status as ProposalStatus)) {
    // Only allow status transitions on locked proposals
    const allowedKeys = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined)
    const nonStatusKeys = allowedKeys.filter((k) => k !== 'status')
    if (nonStatusKeys.length > 0) {
      throw new Error(
        `Proposal is ${current.status}, not draft — only status may be changed (got: ${nonStatusKeys.join(', ')}).`
      )
    }
  }
  const { data, error } = await supabase
    .from('proposals')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update proposal: ${error?.message ?? 'no row returned'}`)
  }
  return data as Proposal
}

export async function deleteProposal(id: string): Promise<void> {
  const { error } = await supabase.from('proposals').delete().eq('id', id)
  if (error) throw new Error(`Couldn't delete proposal: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Preview — kit + input qty → uncommitted preview lines
// ──────────────────────────────────────────────────────────────────────

/**
 * Map kit_line.type → proposal_lines.category (decision 2). Five
 * categories total; 'Other' kit lines map to the 'other' category
 * and inherit markup_subs_percent.
 */
function kitTypeToCategory(t: 'Labor' | 'Material' | 'Equipment' | 'Sub' | 'Other'): ProposalLineCategory {
  switch (t) {
    case 'Labor':
      return 'labor'
    case 'Material':
      return 'material'
    case 'Equipment':
      return 'equipment'
    case 'Sub':
      return 'subcontractor'
    case 'Other':
      return 'other'
  }
}

/**
 * Resolve which markup percent applies to a category at this moment.
 * Materials use markup_materials_percent; subs + other use
 * markup_subs_percent (decision 2). Labor + equipment carry 0
 * because BCA bills the loaded retail rate which already includes
 * margin per KYN methodology — explicit per-line markup would
 * double-count.
 */
function markupForCategory(
  category: ProposalLineCategory,
  settings: { markup_materials_percent: number | null; markup_subs_percent: number | null }
): number {
  switch (category) {
    case 'material':
      return Number(settings.markup_materials_percent ?? 0)
    case 'subcontractor':
    case 'other':
      return Number(settings.markup_subs_percent ?? 0)
    case 'labor':
    case 'equipment':
      return 0
  }
}

/**
 * Generate an uncommitted preview of what proposal_lines a kit
 * would produce for the given input quantity. Pure read — no writes.
 *
 * Side-effects:
 *   • Throws when ANY kit_line has reference_missing (decision 3).
 *     Error names the kit + count so the UI can guide the contractor
 *     back to the kit detail page to repair.
 *   • Lines with NULL or 0 factor surface as placeholder: true with
 *     quantity: 0 — the preview UI's "Needs Input" group (decision 4).
 *   • Lines with NULL resolved_unit_cost (e.g. reference_type='none'
 *     placeholder lines, no rate source) ALSO surface as
 *     placeholder: true with frozen_unit_cost: 0. Contractor must
 *     enter a unit cost in the preview UI before committing
 *     (otherwise the commit step silently drops the line).
 */
export async function previewKitLines(input: {
  kitId: string
  inputQuantity: number
}): Promise<KitPreviewLine[]> {
  if (!Number.isFinite(input.inputQuantity) || input.inputQuantity <= 0) {
    throw new Error('Input quantity must be a positive number.')
  }

  // Load kit + lines + settings + per-line resolved references in parallel
  const kit = await loadKit(input.kitId)
  if (!kit) throw new Error('Kit not found.')

  const [{ data: settings, error: sErr }, resolvedLines] = await Promise.all([
    supabase
      .from('company_settings')
      .select('markup_materials_percent, markup_subs_percent')
      .single(),
    Promise.all(kit.lines.map((l) => resolveKitLineReference(l))),
  ])

  if (sErr || !settings) {
    throw new Error(
      `Couldn't load company settings for markup snapshot: ${sErr?.message ?? 'missing'}`
    )
  }

  // Block preview entirely if any line has a broken reference (decision 3)
  const broken = resolvedLines.filter((r) => r.reference_missing)
  if (broken.length > 0) {
    throw new Error(
      `Kit "${kit.name}" has ${broken.length} broken reference${broken.length === 1 ? '' : 's'} — open the kit to repair before generating proposals.`
    )
  }

  // Build the preview array. sort_order continues by position so the
  // commit step preserves the kit's ordering inside the proposal.
  return resolvedLines.map((resolved, idx): KitPreviewLine => {
    const line = kit.lines[idx]
    const category = kitTypeToCategory(line.type)
    const markupPercent = markupForCategory(category, settings)

    // Placeholder detection (decision 4 + extension):
    //   • NULL or 0 factor → quantity can't be computed
    //   • NULL resolved_unit_cost → no rate to snapshot
    // Either case: surface as placeholder for contractor input.
    const factorMissing = line.factor === null || line.factor === 0
    const costMissing = resolved.resolved_unit_cost === null
    const placeholder = factorMissing || costMissing

    const quantity = placeholder ? 0 : (line.factor as number) * input.inputQuantity
    const unitCost = resolved.resolved_unit_cost ?? 0

    // Audit-only labor/equipment rate snapshot (decision 5). Set only
    // when this line is sourced from a labor_type / equipment_rate
    // reference. Custom-style lines and material/sub/other lines get NULL.
    const laborRate =
      line.type === 'Labor' && line.reference_type === 'labor_type'
        ? resolved.resolved_unit_cost
        : null
    const equipmentRate =
      line.type === 'Equipment' && line.reference_type === 'equipment_rate'
        ? resolved.resolved_unit_cost
        : null

    return {
      source_kit_id: kit.id,
      source_kit_line_id: line.id,
      category,
      label: line.display_name,
      unit: line.factor_unit ?? '',
      quantity,
      frozen_unit_cost: unitCost,
      frozen_labor_rate: laborRate,
      frozen_equipment_rate: equipmentRate,
      frozen_markup_percent: markupPercent,
      frozen_kit_factor: line.factor,
      frozen_reference_label: resolved.resolved_label,
      sort_order: idx,
      selected: true,
      placeholder,
    }
  })
}

// ──────────────────────────────────────────────────────────────────────
// Line CRUD — add (batch + custom), update, delete
// ──────────────────────────────────────────────────────────────────────

/**
 * Look up the max existing sort_order on a proposal so new lines
 * append in stable order rather than colliding with kit-sourced
 * positions.
 */
async function nextSortOrder(proposalId: string): Promise<number> {
  const { data, error } = await supabase
    .from('proposal_lines')
    .select('sort_order')
    .eq('proposal_id', proposalId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`Couldn't read sort order: ${error.message}`)
  }
  return data ? (data.sort_order as number) + 1 : 0
}

/**
 * Look up the parent proposal's status to enforce the editability
 * guard before any line mutation. Throws on missing/RLS-hidden id.
 */
async function assertProposalEditable(proposalId: string): Promise<void> {
  const { data, error } = await supabase
    .from('proposals')
    .select('status')
    .eq('id', proposalId)
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      `Couldn't load proposal for edit: ${error?.message ?? 'not found'}`
    )
  }
  if (!isProposalEditable(data.status as ProposalStatus)) {
    throw new Error(
      `Proposal is ${data.status}, not draft — line edits are blocked. Revert to draft to make changes.`
    )
  }
}

/**
 * Commit a kit preview into proposal_lines. Filters lines that aren't
 * selected, and silently drops lines with quantity=0 (decision 4 —
 * placeholder lines the contractor didn't fill in are excluded
 * cleanly, no validation error).
 *
 * Appends after existing lines — sort_order continues from current max
 * so the kit ordering survives inside a multi-kit proposal.
 */
export async function addLinesFromKitPreview(input: {
  proposalId: string
  lines: KitPreviewLine[]
  kitId: string
}): Promise<ProposalLine[]> {
  await assertProposalEditable(input.proposalId)

  // Filter: selected AND quantity > 0 (proposal_lines CHECK rejects 0)
  const toInsert = input.lines.filter((l) => l.selected && l.quantity > 0)
  if (toInsert.length === 0) return []

  const startSort = await nextSortOrder(input.proposalId)

  const rows = toInsert.map((l, idx) => ({
    proposal_id: input.proposalId,
    source_kit_id: input.kitId,
    source_kit_line_id: l.source_kit_line_id,
    category: l.category,
    label: l.label,
    unit: l.unit,
    quantity: l.quantity,
    frozen_unit_cost: l.frozen_unit_cost,
    frozen_labor_rate: l.frozen_labor_rate,
    frozen_equipment_rate: l.frozen_equipment_rate,
    frozen_markup_percent: l.frozen_markup_percent,
    frozen_kit_factor: l.frozen_kit_factor,
    frozen_reference_label: l.frozen_reference_label,
    sort_order: startSort + idx,
  }))

  const { data, error } = await supabase
    .from('proposal_lines')
    .insert(rows)
    .select()
  if (error || !data) {
    throw new Error(`Couldn't add proposal lines: ${error?.message ?? 'no rows returned'}`)
  }
  return data as ProposalLine[]
}

/**
 * Add a single custom (non-kit-sourced) line. Snapshots the current
 * markup for the category at insert time; rate-audit fields stay NULL
 * because there's no upstream rate source to record (decision 5).
 */
export async function addCustomLine(input: {
  proposalId: string
  category: ProposalLineCategory
  label: string
  unit: string
  quantity: number
  unitCost: number
}): Promise<ProposalLine> {
  await assertProposalEditable(input.proposalId)

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Quantity must be greater than 0.')
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    throw new Error('Unit cost must be 0 or greater.')
  }

  const { data: settings, error: sErr } = await supabase
    .from('company_settings')
    .select('markup_materials_percent, markup_subs_percent')
    .single()
  if (sErr || !settings) {
    throw new Error(
      `Couldn't load settings for markup snapshot: ${sErr?.message ?? 'missing'}`
    )
  }

  const sortOrder = await nextSortOrder(input.proposalId)

  const { data, error } = await supabase
    .from('proposal_lines')
    .insert({
      proposal_id: input.proposalId,
      source_kit_id: null,
      source_kit_line_id: null,
      category: input.category,
      label: input.label.trim(),
      unit: input.unit.trim(),
      quantity: input.quantity,
      frozen_unit_cost: input.unitCost,
      frozen_labor_rate: null, // Custom lines have no rate-table source
      frozen_equipment_rate: null,
      frozen_markup_percent: markupForCategory(input.category, settings),
      frozen_kit_factor: null,
      frozen_reference_label: null,
      sort_order: sortOrder,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't add custom line: ${error?.message ?? 'no row returned'}`)
  }
  return data as ProposalLine
}

/**
 * Patch a proposal line. Editability guard: only allowed when the
 * parent proposal is in 'draft' status.
 */
export async function updateProposalLine(
  id: string,
  patch: Partial<Pick<ProposalLine, 'label' | 'quantity' | 'frozen_unit_cost' | 'sort_order'>>
): Promise<ProposalLine> {
  // Look up parent proposal for the editability guard
  const { data: line, error: lookupErr } = await supabase
    .from('proposal_lines')
    .select('proposal_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !line) {
    throw new Error(
      `Couldn't load proposal line for update: ${lookupErr?.message ?? 'not found'}`
    )
  }
  await assertProposalEditable(line.proposal_id as string)

  const { data, error } = await supabase
    .from('proposal_lines')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update proposal line: ${error?.message ?? 'no row returned'}`)
  }
  return data as ProposalLine
}

export async function deleteProposalLine(id: string): Promise<void> {
  const { data: line, error: lookupErr } = await supabase
    .from('proposal_lines')
    .select('proposal_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !line) {
    throw new Error(
      `Couldn't load proposal line for delete: ${lookupErr?.message ?? 'not found'}`
    )
  }
  await assertProposalEditable(line.proposal_id as string)

  const { error } = await supabase.from('proposal_lines').delete().eq('id', id)
  if (error) throw new Error(`Couldn't delete proposal line: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Totals
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute roll-up totals from a proposal's lines.
 *
 * Decision 5: frozen_unit_cost is the canonical price for every line,
 * regardless of category. Per line:
 *
 *   lineTotal = quantity × frozen_unit_cost
 *   lineMarkup = lineTotal × (frozen_markup_percent / 100)
 *
 * `byCategory` returns pre-markup subtotals per category — sums to
 * `subtotal`. `markupAmount` is the sum of per-line markups (0 for
 * labor + equipment lines because their frozen_markup_percent is 0
 * by construction in previewKitLines / addCustomLine).
 * `grandTotal` = subtotal + markupAmount.
 */
export async function getProposalTotals(proposalId: string): Promise<{
  byCategory: Record<ProposalLineCategory, number>
  subtotal: number
  markupAmount: number
  grandTotal: number
}> {
  const { data, error } = await supabase
    .from('proposal_lines')
    .select('category, quantity, frozen_unit_cost, frozen_markup_percent')
    .eq('proposal_id', proposalId)
  if (error) {
    throw new Error(`Couldn't load proposal totals: ${error.message}`)
  }

  const byCategory: Record<ProposalLineCategory, number> = {
    material: 0,
    labor: 0,
    equipment: 0,
    subcontractor: 0,
    other: 0,
  }
  let subtotal = 0
  let markupAmount = 0

  for (const row of (data ?? []) as Array<{
    category: ProposalLineCategory
    quantity: number
    frozen_unit_cost: number
    frozen_markup_percent: number
  }>) {
    const qty = Number(row.quantity)
    const unit = Number(row.frozen_unit_cost)
    const markup = Number(row.frozen_markup_percent)
    const lineTotal = qty * unit
    byCategory[row.category] += lineTotal
    subtotal += lineTotal
    markupAmount += lineTotal * (markup / 100)
  }

  return {
    byCategory,
    subtotal,
    markupAmount,
    grandTotal: subtotal + markupAmount,
  }
}
