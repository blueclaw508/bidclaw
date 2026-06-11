// Data layer for the proposals + proposal_work_areas + proposal_lines
// tables. All Proposal pages (Prompt 6 Phase 2 editor) read/write
// through these functions — no direct supabase calls in components.
//
// Conventions match companySettings.ts + kits.ts:
//   • Throw on error (callers handle with toast / state)
//   • RLS scopes queries to the current user — no explicit user_id filter
//   • Pricing snapshot is FROZEN at insert; never recomputed from live
//     settings/catalog state (Q3a from Prompt 5 carry-fwd)
//
// Decisions locked from scope conversation (multi-work-area pivot):
//   1. Multi-work-area: proposals are project-level; work area
//      membership lives in proposal_work_areas (1:N).
//   2. Ad-hoc work areas — work_area_id NULL is supported with
//      name_override / description_override carrying the labels.
//   3. Denormalized 5-category subtotals on proposal_work_areas —
//      syncProposalWorkAreaSubtotals must be called after every line
//      CUD that affects the row to prevent drift.
//   4. Disabled work areas keep computing their own subtotals (so the
//      editor shows the opportunity cost) but contribute 0 to the
//      proposal grand total.
//   5. frozen_unit_cost is canonical for ALL calculation.
//      frozen_labor_rate / frozen_equipment_rate are pure audit.
//   6. 'Other' category uses markup_subs_percent until a dedicated
//      markup_other_percent ships (additive Phase 1.5).

import { supabase } from '@/lib/supabase'
import { loadKit, resolveKitLineReference } from '@/lib/kits'
import { syncLeadStageForProposalStatus } from '@/lib/leads'
import { categoryBearsMarkup, lineBase, lineMarkup, lineTotal } from '@/lib/money'
import type {
  KitPreviewLine,
  Proposal,
  ProposalLine,
  ProposalLineCategory,
  ProposalListRow,
  ProposalStatus,
  ProposalWithWorkAreas,
  ProposalWorkArea,
  ProposalWorkAreaResolved,
} from '@/lib/types'

// Re-export so callers can `import { Proposal } from '@/lib/proposals'`.
export type {
  KitPreviewLine,
  Proposal,
  ProposalLine,
  ProposalLineCategory,
  ProposalListRow,
  ProposalStatus,
  ProposalWithWorkAreas,
  ProposalWorkArea,
  ProposalWorkAreaResolved,
}

// ──────────────────────────────────────────────────────────────────────
// Editability helper
// ──────────────────────────────────────────────────────────────────────

/** Source of truth for "can this proposal still be edited?" */
export function isProposalEditable(status: ProposalStatus): boolean {
  return status === 'draft'
}

/**
 * Available status transitions per current status — single source of
 * truth for the editor's status dropdown items.
 *
 *   target  → the status to write
 *   label   → button label (contractor-direct, not jargon)
 *   tone    → 'primary' (forward progress) or 'secondary' (revert/back)
 *
 * Transition machine (Phase 3c, Option A, 5-state):
 *   draft     → presented
 *   presented → accepted | declined | draft
 *   accepted  → completed | draft
 *   declined  → draft
 *   completed → accepted | draft   (rare reopens)
 *
 * The "presented" enum value is the wire format; UI labels say
 * "Send to client" because that's the contractor's mental model.
 */
export interface StatusTransition {
  target: ProposalStatus
  label: string
  tone: 'primary' | 'secondary'
}

export function availableTransitions(status: ProposalStatus): StatusTransition[] {
  switch (status) {
    case 'draft':
      return [
        { target: 'presented', label: 'Send to client', tone: 'primary' },
      ]
    case 'presented':
      return [
        { target: 'accepted', label: 'Mark as accepted', tone: 'primary' },
        { target: 'declined', label: 'Mark as declined', tone: 'primary' },
        { target: 'draft', label: 'Revert to draft', tone: 'secondary' },
      ]
    case 'accepted':
      return [
        { target: 'completed', label: 'Mark as completed', tone: 'primary' },
        { target: 'draft', label: 'Revert to draft', tone: 'secondary' },
      ]
    case 'declined':
      return [
        { target: 'draft', label: 'Revert to draft', tone: 'secondary' },
      ]
    case 'completed':
      return [
        { target: 'accepted', label: 'Reopen (back to accepted)', tone: 'secondary' },
        { target: 'draft', label: 'Revert to draft', tone: 'secondary' },
      ]
  }
}

// ──────────────────────────────────────────────────────────────────────
// Proposal CRUD
// ──────────────────────────────────────────────────────────────────────

/**
 * Lightweight row used to render the per-project Proposals tab.
 * Single round-trip via PostgREST embedded resources — pulls each
 * proposal's work area count + line count + per-line aggregates for
 * the grand total calc.
 *
 * Grand-total math mirrors getProposalTotals:
 *   lineTotal = quantity × frozen_unit_cost
 *   lineMarkup = lineTotal × frozen_markup_percent / 100
 *   grand_total = sum(lineTotal + lineMarkup) for ENABLED work areas only
 */
export async function listProposalsByProject(
  projectId: string
): Promise<ProposalListRow[]> {
  const { data, error } = await supabase
    .from('proposals')
    .select(
      `*,
       proposal_work_areas (
         id, enabled,
         proposal_lines ( quantity, frozen_unit_cost, frozen_markup_percent )
       )`
    )
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (error) {
    throw new Error(`Couldn't load proposals: ${error.message}`)
  }
  type RawRow = Proposal & {
    proposal_work_areas: Array<{
      id: string
      enabled: boolean
      proposal_lines: Array<{
        quantity: number
        frozen_unit_cost: number
        frozen_markup_percent: number
      }>
    }>
  }
  return ((data ?? []) as RawRow[]).map((row) => {
    const wAreas = row.proposal_work_areas ?? []
    let grand_total = 0
    let line_count = 0
    for (const wa of wAreas) {
      const lines = wa.proposal_lines ?? []
      line_count += lines.length
      if (!wa.enabled) continue // disabled work areas don't roll up
      for (const l of lines) {
        grand_total += lineTotal(l)
      }
    }
    // Strip embedded sub-resources before returning the row shape
    const { proposal_work_areas, ...rest } = row
    void proposal_work_areas
    return {
      ...rest,
      work_area_count: wAreas.length,
      line_count,
      grand_total,
    } satisfies ProposalListRow
  })
}

/**
 * Load the editor payload — proposal + every proposal_work_area
 * (with source work_area name/description for fallback) + each work
 * area's lines, ordered. Returns null when the id doesn't exist for
 * the current user (RLS makes this look identical to "not found").
 */
export async function getProposal(
  id: string
): Promise<ProposalWithWorkAreas | null> {
  const { data, error } = await supabase
    .from('proposals')
    .select(
      `*,
       proposal_work_areas (
         *,
         work_areas ( id, name, description ),
         proposal_lines ( * )
       )`
    )
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new Error(`Couldn't load proposal: ${error.message}`)
  }
  if (!data) return null

  type RawWorkArea = ProposalWorkArea & {
    work_areas: { id: string; name: string; description: string | null } | null
    proposal_lines: ProposalLine[]
  }
  const raw = data as Proposal & { proposal_work_areas: RawWorkArea[] }

  const work_areas: ProposalWorkAreaResolved[] = (raw.proposal_work_areas ?? [])
    .slice()
    // Sort work areas by position ascending; PostgREST embed doesn't apply order
    .sort((a, b) => a.position - b.position)
    .map((wa) => {
      const source = wa.work_areas ?? null
      const resolved_name =
        wa.name_override?.trim() || source?.name || 'Untitled work area'
      const resolved_description =
        wa.description_override ?? source?.description ?? null
      const lines = (wa.proposal_lines ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
      // Strip embedded sub-resources from the work area row before returning
      const { work_areas: _wa, proposal_lines: _pl, ...waCore } = wa
      void _wa
      void _pl
      return {
        ...waCore,
        resolved_name,
        resolved_description,
        source_work_area: source,
        lines,
      } satisfies ProposalWorkAreaResolved
    })

  // Strip the embedded array before returning
  const { proposal_work_areas, ...proposalCore } = raw
  void proposal_work_areas
  return { ...proposalCore, work_areas }
}

/**
 * Create a new draft proposal at the project level. Work areas are
 * attached afterwards via addWorkAreaToProposal.
 */
export async function createProposal(input: {
  projectId: string
  name: string
}): Promise<Proposal> {
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      project_id: input.projectId,
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
 * Patch a proposal header. Editability guard: once status != 'draft'
 * only the `status` field may be patched.
 *
 * Lifecycle side-effects (Phase 1 P1-B):
 *   • First transition to 'presented' stamps presented_at (0010) —
 *     powers the leads list "proposal sent" date filter.
 *   • Status writes advance the linked lead's pipeline stage
 *     (presented → Proposed, accepted → Signed, completed →
 *     Completed). Best-effort: a sync failure never fails the
 *     proposal write. Declined intentionally does NOT auto-move the
 *     lead — the editor confirms Lost with the contractor instead.
 */
export async function updateProposal(
  id: string,
  patch: Partial<Pick<Proposal, 'name' | 'notes' | 'status'>>
): Promise<Proposal> {
  const { data: current, error: lookupErr } = await supabase
    .from('proposals')
    .select('status, presented_at')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !current) {
    throw new Error(
      `Couldn't load proposal for update: ${lookupErr?.message ?? 'not found'}`
    )
  }
  if (!isProposalEditable(current.status as ProposalStatus)) {
    const nonStatusKeys = Object.keys(patch)
      .filter((k) => patch[k as keyof typeof patch] !== undefined)
      .filter((k) => k !== 'status')
    if (nonStatusKeys.length > 0) {
      throw new Error(
        `Proposal is ${current.status}, not draft — only status may be changed (got: ${nonStatusKeys.join(', ')}).`
      )
    }
  }
  const writePatch: Record<string, unknown> = { ...patch }
  if (patch.status === 'presented' && !current.presented_at) {
    writePatch.presented_at = new Date().toISOString()
  }
  const { data, error } = await supabase
    .from('proposals')
    .update(writePatch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update proposal: ${error?.message ?? 'no row returned'}`)
  }
  const updated = data as Proposal
  if (patch.status) {
    try {
      await syncLeadStageForProposalStatus(updated.project_id, patch.status)
    } catch {
      // Best-effort — the proposal write already succeeded.
    }
  }
  return updated
}

export async function deleteProposal(id: string): Promise<void> {
  const { error } = await supabase.from('proposals').delete().eq('id', id)
  if (error) throw new Error(`Couldn't delete proposal: ${error.message}`)
}

/**
 * Duplicate a proposal as a fresh draft, carrying forward every frozen
 * snapshot field VERBATIM. The architectural keystone: a duplicate
 * preserves the source's pricing snapshot — frozen_unit_cost,
 * frozen_markup_percent, frozen_labor_rate, frozen_equipment_rate
 * are copied as-is. Current settings are NEVER read.
 *
 *   Source name "Foo"  → new name "Foo (copy)"
 *   Source status any  → new status 'draft' (only editable state)
 *   Source notes verbatim
 *   Source work areas: 1:1 copy with mapped FK
 *   Source lines: 1:1 copy under the mapped pwa, frozen fields verbatim
 *
 * Atomicity: JS-side with defensive CASCADE cleanup on error. If a
 * later step fails after the proposal row exists, we delete the
 * partial proposal → DB cascade removes any inserted work areas + lines
 * → no orphans. Phase 1.5 backlog: migrate to a Postgres RPC for true
 * transactional atomicity.
 *
 * Note on `catalog_item_id`: the spec mentioned preserving a
 * catalog_item_id FK for traceability, but that column doesn't exist on
 * proposal_lines yet (Phase 1.5 backlog item from Phase 2 closeout —
 * `source_catalog_item_id` is planned but not landed). Today the
 * catalog hint lives in `frozen_reference_label`, which we DO preserve.
 */
export async function duplicateProposal(
  sourceId: string
): Promise<{ newProposalId: string }> {
  // Step 1 — load full source. getProposal returns the proposal with
  // resolved work areas + their lines, sorted, RLS-scoped.
  const source = await getProposal(sourceId)
  if (!source) {
    throw new Error('Source proposal not found (or not yours).')
  }

  // Step 2 — insert the new proposal row. Always status='draft'
  // regardless of source status; the standard "create-from-template"
  // pattern. Name suffix " (copy)" is deliberately naive — no
  // "(copy 2)" detection; contractor can rename in the editor.
  const { data: newProposal, error: pErr } = await supabase
    .from('proposals')
    .insert({
      project_id: source.project_id,
      name: `${source.name} (copy)`,
      notes: source.notes,
      status: 'draft',
    })
    .select('id')
    .single()
  if (pErr || !newProposal) {
    throw new Error(
      `Couldn't create duplicate proposal: ${pErr?.message ?? 'no row returned'}`
    )
  }
  const newProposalId = newProposal.id as string

  // From here on, any error must trigger cleanup of the partial new
  // proposal — delete cascades remove any work_areas / lines we may
  // have inserted before the failure.
  try {
    // Edge case: source has zero work areas → skip the WA + line loops
    // entirely. The new proposal is just an empty shell, which is fine.
    if (source.work_areas.length === 0) {
      return { newProposalId }
    }

    // Step 3 — bulk insert proposal_work_areas. Returning ids in the
    // same order as the input array would let us pair source→new
    // without a secondary lookup, but PostgREST insert+select doesn't
    // guarantee insert order. So we do one-shot insert with all rows,
    // then match by `position` (unique within a proposal).
    type NewPwaRow = {
      proposal_id: string
      work_area_id: string | null
      position: number
      name_override: string | null
      description_override: string | null
      enabled: boolean
      labor_subtotal: number
      material_subtotal: number
      equipment_subtotal: number
      subcontractor_subtotal: number
      other_subtotal: number
    }
    const newPwaRows: NewPwaRow[] = source.work_areas.map((wa) => ({
      proposal_id: newProposalId,
      // work_area_id stays NULL on ad-hoc WAs; otherwise points to the
      // same source project work_area as the original.
      work_area_id: wa.work_area_id ?? null,
      position: wa.position,
      name_override: wa.name_override,
      description_override: wa.description_override,
      enabled: wa.enabled,
      labor_subtotal: Number(wa.labor_subtotal),
      material_subtotal: Number(wa.material_subtotal),
      equipment_subtotal: Number(wa.equipment_subtotal),
      subcontractor_subtotal: Number(wa.subcontractor_subtotal),
      other_subtotal: Number(wa.other_subtotal),
    }))

    const { data: insertedPwas, error: waErr } = await supabase
      .from('proposal_work_areas')
      .insert(newPwaRows)
      .select('id, position')
    if (waErr || !insertedPwas) {
      throw new Error(
        `Couldn't copy work areas: ${waErr?.message ?? 'no rows returned'}`
      )
    }

    // Build map: sourcePwaId → newPwaId, keyed by position which is
    // unique inside a proposal.
    const positionToNewPwaId = new Map<number, string>()
    for (const row of insertedPwas as Array<{ id: string; position: number }>) {
      positionToNewPwaId.set(row.position, row.id)
    }
    const sourcePwaIdToNewPwaId = new Map<string, string>()
    for (const sourceWa of source.work_areas) {
      const newId = positionToNewPwaId.get(sourceWa.position)
      if (!newId) {
        throw new Error(
          `Couldn't pair duplicated work area at position ${sourceWa.position} — insert returned mismatched positions.`
        )
      }
      sourcePwaIdToNewPwaId.set(sourceWa.id, newId)
    }

    // Step 4 — bulk insert proposal_lines for all work areas in one
    // call. Each line's frozen_* fields are copied VERBATIM — the
    // architectural keystone of duplication. Skip work areas with
    // zero lines (no-op insert is a wasted round-trip but harmless;
    // we filter to keep the insert payload tight).
    type NewLineRow = {
      proposal_id: string
      proposal_work_area_id: string
      source_kit_id: string | null
      source_kit_line_id: string | null
      category: ProposalLineCategory
      label: string
      unit: string
      quantity: number
      frozen_unit_cost: number
      frozen_labor_rate: number | null
      frozen_equipment_rate: number | null
      frozen_markup_percent: number
      frozen_kit_factor: number | null
      frozen_reference_label: string | null
      sort_order: number
    }
    const newLineRows: NewLineRow[] = []
    for (const sourceWa of source.work_areas) {
      const newPwaId = sourcePwaIdToNewPwaId.get(sourceWa.id)!
      for (const l of sourceWa.lines) {
        newLineRows.push({
          proposal_id: newProposalId,
          proposal_work_area_id: newPwaId,
          source_kit_id: l.source_kit_id,
          source_kit_line_id: l.source_kit_line_id,
          category: l.category,
          label: l.label,
          unit: l.unit,
          quantity: Number(l.quantity),
          // VERBATIM frozen-rate carry-forward. Do not coerce or
          // re-resolve from current settings under any circumstance.
          frozen_unit_cost: Number(l.frozen_unit_cost),
          frozen_labor_rate:
            l.frozen_labor_rate === null ? null : Number(l.frozen_labor_rate),
          frozen_equipment_rate:
            l.frozen_equipment_rate === null
              ? null
              : Number(l.frozen_equipment_rate),
          frozen_markup_percent: Number(l.frozen_markup_percent),
          frozen_kit_factor:
            l.frozen_kit_factor === null ? null : Number(l.frozen_kit_factor),
          frozen_reference_label: l.frozen_reference_label,
          sort_order: l.sort_order,
        })
      }
    }

    if (newLineRows.length > 0) {
      const { error: lErr } = await supabase
        .from('proposal_lines')
        .insert(newLineRows)
      if (lErr) {
        throw new Error(`Couldn't copy line items: ${lErr.message}`)
      }
    }

    return { newProposalId }
  } catch (err) {
    // Defensive cleanup: delete the partial proposal. CASCADE on the
    // 3 FKs (proposals → proposal_work_areas, proposals → proposal_lines,
    // proposal_work_areas → proposal_lines) confirmed in Phase 3b
    // means deleting the proposal removes everything we just inserted.
    try {
      await deleteProposal(newProposalId)
    } catch (cleanupErr) {
      // Swallow cleanup error so the original failure is what the user
      // sees. Log to console for diagnostic.
      console.error('[duplicateProposal] cleanup failed:', cleanupErr)
    }
    throw err instanceof Error
      ? err
      : new Error('Duplicate failed for an unknown reason.')
  }
}

// ──────────────────────────────────────────────────────────────────────
// proposal_work_areas CRUD
// ──────────────────────────────────────────────────────────────────────

/**
 * Look up the next sort position so newly-added work areas append to
 * the end of the proposal's editor list.
 */
async function nextProposalWorkAreaPosition(proposalId: string): Promise<number> {
  const { data, error } = await supabase
    .from('proposal_work_areas')
    .select('position')
    .eq('proposal_id', proposalId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`Couldn't read work area position: ${error.message}`)
  }
  return data ? (data.position as number) + 1 : 0
}

/**
 * Attach a work area to a proposal. Pass workAreaId=null for ad-hoc
 * work areas (change orders / allowances); the name/description
 * overrides become the displayed labels in that case.
 *
 * Editability guard enforced at the parent proposal level.
 */
export async function addWorkAreaToProposal(input: {
  proposalId: string
  workAreaId: string | null
  nameOverride?: string
  descriptionOverride?: string
}): Promise<ProposalWorkArea> {
  await assertProposalEditable(input.proposalId)
  const position = await nextProposalWorkAreaPosition(input.proposalId)
  const { data, error } = await supabase
    .from('proposal_work_areas')
    .insert({
      proposal_id: input.proposalId,
      work_area_id: input.workAreaId,
      position,
      name_override: input.nameOverride?.trim() || null,
      description_override: input.descriptionOverride?.trim() || null,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(
      `Couldn't attach work area to proposal: ${error?.message ?? 'no row returned'}`
    )
  }
  return data as ProposalWorkArea
}

/**
 * Patch a proposal_work_area. Allowed fields: name_override,
 * description_override, enabled, position. Subtotals are managed by
 * syncProposalWorkAreaSubtotals, not direct patches.
 */
export async function updateProposalWorkArea(
  id: string,
  patch: Partial<Pick<ProposalWorkArea,
    'name_override' | 'description_override' | 'enabled' | 'position'>>
): Promise<ProposalWorkArea> {
  const { data: row, error: lookupErr } = await supabase
    .from('proposal_work_areas')
    .select('proposal_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !row) {
    throw new Error(
      `Couldn't load proposal_work_area for update: ${lookupErr?.message ?? 'not found'}`
    )
  }
  await assertProposalEditable(row.proposal_id as string)

  const { data, error } = await supabase
    .from('proposal_work_areas')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(
      `Couldn't update proposal_work_area: ${error?.message ?? 'no row returned'}`
    )
  }
  return data as ProposalWorkArea
}

/**
 * Remove a work area from a proposal. CASCADE deletes attached
 * proposal_lines. The source project work_area is preserved.
 */
export async function removeWorkAreaFromProposal(id: string): Promise<void> {
  const { data: row, error: lookupErr } = await supabase
    .from('proposal_work_areas')
    .select('proposal_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !row) {
    throw new Error(
      `Couldn't load proposal_work_area for delete: ${lookupErr?.message ?? 'not found'}`
    )
  }
  await assertProposalEditable(row.proposal_id as string)

  const { error } = await supabase
    .from('proposal_work_areas')
    .delete()
    .eq('id', id)
  if (error) {
    throw new Error(`Couldn't remove work area from proposal: ${error.message}`)
  }
}

/**
 * Rewrite position for every work area in the supplied order. Used
 * after dnd-kit drag-drop of the work area cards in the editor.
 * Skips no-op writes when the position already matches.
 */
export async function reorderProposalWorkAreas(
  proposalId: string,
  proposalWorkAreaIdsInOrder: string[]
): Promise<void> {
  await assertProposalEditable(proposalId)
  const results = await Promise.all(
    proposalWorkAreaIdsInOrder.map((id, idx) =>
      supabase.from('proposal_work_areas').update({ position: idx }).eq('id', id)
    )
  )
  const firstErr = results.find((r) => r.error)
  if (firstErr?.error) {
    throw new Error(`Reorder failed: ${firstErr.error.message}`)
  }
}

/**
 * Recompute the 5 denormalized subtotals on a proposal_work_area
 * from its current proposal_lines. Must be called after every line
 * CUD path that affects this work area. Returns the refreshed row.
 *
 * Math: subtotal_X = sum of (quantity × frozen_unit_cost × (1 +
 * frozen_markup_percent/100)) for lines where category=X.
 */
export async function syncProposalWorkAreaSubtotals(
  proposalWorkAreaId: string
): Promise<ProposalWorkArea> {
  const { data: lines, error: lErr } = await supabase
    .from('proposal_lines')
    .select('category, quantity, frozen_unit_cost, frozen_markup_percent')
    .eq('proposal_work_area_id', proposalWorkAreaId)
  if (lErr) {
    throw new Error(`Couldn't load lines for subtotal sync: ${lErr.message}`)
  }
  const subtotals: Record<ProposalLineCategory, number> = {
    labor: 0,
    material: 0,
    equipment: 0,
    subcontractor: 0,
    other: 0,
  }
  for (const l of (lines ?? []) as Array<{
    category: ProposalLineCategory
    quantity: number
    frozen_unit_cost: number
    frozen_markup_percent: number
  }>) {
    subtotals[l.category] += lineTotal(l)
  }
  const { data, error } = await supabase
    .from('proposal_work_areas')
    .update({
      labor_subtotal: subtotals.labor,
      material_subtotal: subtotals.material,
      equipment_subtotal: subtotals.equipment,
      subcontractor_subtotal: subtotals.subcontractor,
      other_subtotal: subtotals.other,
    })
    .eq('id', proposalWorkAreaId)
    .select()
    .single()
  if (error || !data) {
    throw new Error(
      `Couldn't write subtotals: ${error?.message ?? 'no row returned'}`
    )
  }
  return data as ProposalWorkArea
}

// ──────────────────────────────────────────────────────────────────────
// Preview — kit + input qty → uncommitted preview lines
// ──────────────────────────────────────────────────────────────────────

/** kit_line.type → proposal_lines.category mapping. */
function kitTypeToCategory(t: 'Labor' | 'Material' | 'Equipment' | 'Sub' | 'Other'): ProposalLineCategory {
  switch (t) {
    case 'Labor': return 'labor'
    case 'Material': return 'material'
    case 'Equipment': return 'equipment'
    case 'Sub': return 'subcontractor'
    case 'Other': return 'other'
  }
}

/**
 * Resolve markup percent for a category from current settings.
 * Labor + equipment get 0 (KYN methodology — rates already include
 * margin). Material uses markup_materials_percent. Sub + other use
 * markup_subs_percent.
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
 * Generate an uncommitted preview of what proposal_lines a kit would
 * produce for the given input quantity. Pure read — no writes.
 *
 * Side-effects:
 *   • Throws when ANY kit_line has reference_missing — error names the
 *     kit + count so the UI can route the contractor back to the kit
 *     detail page to repair.
 *   • Lines with NULL or 0 factor, OR with NULL resolved unit cost,
 *     surface as placeholder=true with quantity=0 / frozen_unit_cost=0.
 *     The preview UI groups these as "Needs Input".
 */
export async function previewKitLines(input: {
  kitId: string
  inputQuantity: number
}): Promise<KitPreviewLine[]> {
  if (!Number.isFinite(input.inputQuantity) || input.inputQuantity <= 0) {
    throw new Error('Input quantity must be a positive number.')
  }

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

  const broken = resolvedLines.filter((r) => r.reference_missing)
  if (broken.length > 0) {
    throw new Error(
      `Kit "${kit.name}" has ${broken.length} broken reference${broken.length === 1 ? '' : 's'} — open the kit to repair before generating proposals.`
    )
  }

  return resolvedLines.map((resolved, idx): KitPreviewLine => {
    const line = kit.lines[idx]
    const category = kitTypeToCategory(line.type)
    const markupPercent = markupForCategory(category, settings)

    const factorMissing = line.factor === null || line.factor === 0
    const costMissing = resolved.resolved_unit_cost === null
    const placeholder = factorMissing || costMissing

    const quantity = placeholder ? 0 : (line.factor as number) * input.inputQuantity
    const unitCost = resolved.resolved_unit_cost ?? 0

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
 * Look up the max existing sort_order on a proposal_work_area so new
 * lines append in stable order. Scoped to one work area, not the
 * whole proposal — each work area's lines have their own positions.
 */
async function nextLineSortOrder(proposalWorkAreaId: string): Promise<number> {
  const { data, error } = await supabase
    .from('proposal_lines')
    .select('sort_order')
    .eq('proposal_work_area_id', proposalWorkAreaId)
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
 * guard before any line / work area mutation.
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
 * Look up the proposal_id for a given proposal_work_area_id (used by
 * line CRUD to enforce the editability guard at the proposal level).
 */
async function proposalIdForWorkArea(proposalWorkAreaId: string): Promise<string> {
  const { data, error } = await supabase
    .from('proposal_work_areas')
    .select('proposal_id')
    .eq('id', proposalWorkAreaId)
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      `Couldn't load proposal_work_area: ${error?.message ?? 'not found'}`
    )
  }
  return data.proposal_id as string
}

/**
 * Commit a kit preview into proposal_lines on a specific work area
 * inside an existing proposal. Filters selected=false and silently
 * drops quantity=0 placeholders. Appends after existing lines on that
 * work area (sort_order continues from the current max).
 *
 * Triggers a subtotal sync on the affected proposal_work_area so the
 * editor's denormalized totals stay in step with the lines.
 */
export async function addLinesFromKitPreview(input: {
  proposalWorkAreaId: string
  lines: KitPreviewLine[]
  kitId: string
}): Promise<ProposalLine[]> {
  const proposalId = await proposalIdForWorkArea(input.proposalWorkAreaId)
  await assertProposalEditable(proposalId)

  const toInsert = input.lines.filter((l) => l.selected && l.quantity > 0)
  if (toInsert.length === 0) return []

  const startSort = await nextLineSortOrder(input.proposalWorkAreaId)
  const rows = toInsert.map((l, idx) => ({
    proposal_id: proposalId,
    proposal_work_area_id: input.proposalWorkAreaId,
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
    throw new Error(
      `Couldn't add proposal lines: ${error?.message ?? 'no rows returned'}`
    )
  }
  await syncProposalWorkAreaSubtotals(input.proposalWorkAreaId)
  return data as ProposalLine[]
}

/**
 * Add a single custom (non-kit-sourced) line to a work area. Snapshots
 * current markup for the category. Audit rate fields stay NULL —
 * custom lines have no upstream rate source. Triggers subtotal sync.
 */
export async function addCustomLine(input: {
  proposalWorkAreaId: string
  category: ProposalLineCategory
  label: string
  unit: string
  quantity: number
  unitCost: number
  /** Optional traceability — set when the line was picked from the catalog. */
  catalogItemId?: string
}): Promise<ProposalLine> {
  const proposalId = await proposalIdForWorkArea(input.proposalWorkAreaId)
  await assertProposalEditable(proposalId)

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

  const sortOrder = await nextLineSortOrder(input.proposalWorkAreaId)
  // catalogItemId is accepted today as a traceability hint; we don't
  // have a dedicated FK column on proposal_lines for it yet, so it's
  // stashed into frozen_reference_label when supplied + nothing else.
  // Phase 1.5 polish item: add proposal_lines.source_catalog_item_id.
  const _catalogHint = input.catalogItemId ?? null
  void _catalogHint

  const { data, error } = await supabase
    .from('proposal_lines')
    .insert({
      proposal_id: proposalId,
      proposal_work_area_id: input.proposalWorkAreaId,
      source_kit_id: null,
      source_kit_line_id: null,
      category: input.category,
      label: input.label.trim(),
      unit: input.unit.trim(),
      quantity: input.quantity,
      frozen_unit_cost: input.unitCost,
      frozen_labor_rate: null,
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
  await syncProposalWorkAreaSubtotals(input.proposalWorkAreaId)
  return data as ProposalLine
}

/**
 * Patch a proposal_line. Editability guard via parent proposal. After
 * the patch lands, recompute the parent work area's subtotals so the
 * editor's per-section + grand-total roll-up stays current.
 *
 * Phase 3a additive: `frozen_markup_percent` is now patchable, but
 * only on material / subcontractor / other lines (labor + equipment
 * carry markup=0 by KYN convention — rates already include margin)
 * and only within 0..200. The DB column is NOT NULL so NaN/negative
 * patches would also be rejected by Postgres; we surface a cleaner
 * error here first.
 */
/** Patchable fields on a proposal line — shared by the single-line and
 * batched save paths. */
export type ProposalLinePatch = Partial<Pick<ProposalLine,
  'label' | 'quantity' | 'frozen_unit_cost' | 'frozen_markup_percent' | 'sort_order' | 'unit'>>

export async function updateProposalLine(
  id: string,
  patch: ProposalLinePatch
): Promise<ProposalLine> {
  const { data: line, error: lookupErr } = await supabase
    .from('proposal_lines')
    .select('proposal_id, proposal_work_area_id, category')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !line) {
    throw new Error(
      `Couldn't load proposal line for update: ${lookupErr?.message ?? 'not found'}`
    )
  }
  await assertProposalEditable(line.proposal_id as string)

  if (patch.frozen_markup_percent !== undefined) {
    const category = line.category as ProposalLineCategory
    if (!categoryBearsMarkup(category)) {
      throw new Error(
        `Markup is fixed at 0 for ${category} lines (KYN methodology — rates already include margin).`
      )
    }
    const m = Number(patch.frozen_markup_percent)
    if (!Number.isFinite(m) || m < 0 || m > 200) {
      throw new Error('Markup must be between 0 and 200.')
    }
  }

  const { data, error } = await supabase
    .from('proposal_lines')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update proposal line: ${error?.message ?? 'no row returned'}`)
  }
  await syncProposalWorkAreaSubtotals(line.proposal_work_area_id as string)
  return data as ProposalLine
}

export async function deleteProposalLine(id: string): Promise<void> {
  const { data: line, error: lookupErr } = await supabase
    .from('proposal_lines')
    .select('proposal_id, proposal_work_area_id')
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
  await syncProposalWorkAreaSubtotals(line.proposal_work_area_id as string)
}

/**
 * Batched save path for the editor's unified Save bar (P1-D cleanup 1).
 *
 * Replaces N independent updateProposalLine / deleteProposalLine calls.
 * The per-line functions each do lookup + editability check + write +
 * full subtotal re-sync (5 queries per line), and when fired in
 * parallel their subtotal syncs RACE on a shared work area — a sync
 * can read the line set mid-batch and persist a stale subtotal.
 *
 * This path does:
 *   1. ONE editability check on the parent proposal
 *   2. ONE lookup for every touched line (validates ownership +
 *      markup-patch rules before any write)
 *   3. Parallel per-line UPDATEs (distinct rows — no conflict) + one
 *      bulk DELETE
 *   4. ONE subtotal sync per affected work area, only after every
 *      write has landed
 *
 * Lines present in both `updates` and `deleteIds` are treated as
 * deletes (the old code raced an update against the delete).
 */
export async function saveProposalLines(input: {
  proposalId: string
  updates: Array<{ id: string; patch: ProposalLinePatch }>
  deleteIds: string[]
}): Promise<void> {
  const deleteIdSet = new Set(input.deleteIds)
  const updates = input.updates.filter((u) => !deleteIdSet.has(u.id))
  if (updates.length === 0 && deleteIdSet.size === 0) return

  await assertProposalEditable(input.proposalId)

  const touchedIds = [...new Set([...updates.map((u) => u.id), ...deleteIdSet])]
  const { data: lines, error: lookupErr } = await supabase
    .from('proposal_lines')
    .select('id, proposal_id, proposal_work_area_id, category')
    .in('id', touchedIds)
  if (lookupErr) {
    throw new Error(`Couldn't load lines for save: ${lookupErr.message}`)
  }
  type TouchedLine = {
    id: string
    proposal_id: string
    proposal_work_area_id: string
    category: ProposalLineCategory
  }
  const byId = new Map(((lines ?? []) as TouchedLine[]).map((l) => [l.id, l]))
  for (const id of touchedIds) {
    const row = byId.get(id)
    if (!row) {
      throw new Error(
        'One of the edited lines no longer exists — reload the proposal and try again.'
      )
    }
    if (row.proposal_id !== input.proposalId) {
      throw new Error('Line does not belong to this proposal.')
    }
  }

  // Markup-patch rules — identical to updateProposalLine (Phase 3a).
  for (const u of updates) {
    if (u.patch.frozen_markup_percent !== undefined) {
      const category = byId.get(u.id)!.category
      if (!categoryBearsMarkup(category)) {
        throw new Error(
          `Markup is fixed at 0 for ${category} lines (KYN methodology — rates already include margin).`
        )
      }
      const m = Number(u.patch.frozen_markup_percent)
      if (!Number.isFinite(m) || m < 0 || m > 200) {
        throw new Error('Markup must be between 0 and 200.')
      }
    }
  }

  // Writes — no per-write subtotal sync.
  const writeOps: Promise<void>[] = updates.map(async (u) => {
    const { error } = await supabase
      .from('proposal_lines')
      .update(u.patch)
      .eq('id', u.id)
    if (error) throw new Error(`Couldn't update proposal line: ${error.message}`)
  })
  if (deleteIdSet.size > 0) {
    writeOps.push(
      (async () => {
        const { error } = await supabase
          .from('proposal_lines')
          .delete()
          .in('id', [...deleteIdSet])
        if (error) throw new Error(`Couldn't delete proposal lines: ${error.message}`)
      })()
    )
  }
  await Promise.all(writeOps)

  // One sync per affected work area, after all writes are visible.
  const pwaIds = [...new Set(touchedIds.map((id) => byId.get(id)!.proposal_work_area_id))]
  await Promise.all(pwaIds.map((id) => syncProposalWorkAreaSubtotals(id)))
}

// ──────────────────────────────────────────────────────────────────────
// Totals
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-work-area + grand totals for the editor's bottom strip.
 *
 *   workAreas[]:
 *     id, enabled, byCategory subtotals, subtotal (pre-markup),
 *     markupAmount, total (sub + markup)
 *
 *   grandSubtotal / grandMarkupAmount / grandTotal:
 *     ROLLUP of ENABLED work areas only. Disabled work areas still
 *     surface their own numbers in workAreas[] so the editor can show
 *     opportunity cost.
 */
export async function getProposalTotals(proposalId: string): Promise<{
  workAreas: Array<{
    id: string
    enabled: boolean
    byCategory: Record<ProposalLineCategory, number>
    subtotal: number
    markupAmount: number
    total: number
  }>
  grandSubtotal: number
  grandMarkupAmount: number
  grandTotal: number
}> {
  // Pull every work area + its lines in one round-trip
  const { data, error } = await supabase
    .from('proposal_work_areas')
    .select(
      `id, enabled,
       proposal_lines ( category, quantity, frozen_unit_cost, frozen_markup_percent )`
    )
    .eq('proposal_id', proposalId)
    .order('position', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load proposal totals: ${error.message}`)
  }
  type RawWA = {
    id: string
    enabled: boolean
    proposal_lines: Array<{
      category: ProposalLineCategory
      quantity: number
      frozen_unit_cost: number
      frozen_markup_percent: number
    }>
  }

  const workAreas: Array<{
    id: string
    enabled: boolean
    byCategory: Record<ProposalLineCategory, number>
    subtotal: number
    markupAmount: number
    total: number
  }> = []

  let grandSubtotal = 0
  let grandMarkupAmount = 0

  for (const wa of (data ?? []) as RawWA[]) {
    const byCategory: Record<ProposalLineCategory, number> = {
      labor: 0,
      material: 0,
      equipment: 0,
      subcontractor: 0,
      other: 0,
    }
    let subtotal = 0
    let markupAmount = 0
    for (const l of wa.proposal_lines ?? []) {
      byCategory[l.category] += lineBase(l)
      subtotal += lineBase(l)
      markupAmount += lineMarkup(l)
    }
    const total = subtotal + markupAmount
    workAreas.push({
      id: wa.id,
      enabled: wa.enabled,
      byCategory,
      subtotal,
      markupAmount,
      total,
    })
    if (wa.enabled) {
      grandSubtotal += subtotal
      grandMarkupAmount += markupAmount
    }
  }

  return {
    workAreas,
    grandSubtotal,
    grandMarkupAmount,
    grandTotal: grandSubtotal + grandMarkupAmount,
  }
}
