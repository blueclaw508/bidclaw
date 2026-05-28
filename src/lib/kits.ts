// Data layer for the kits + kit_lines tables. All Kit pages (list,
// detail, line items) read/write through these functions — no direct
// supabase calls in components.
//
// Conventions match companySettings.ts:
//   • Throw on error (callers handle with toast / state)
//   • RLS scopes queries to the current user — no explicit user_id filter
//   • Lightweight lookup helpers for the line-item reference dropdowns
//
// Forward use (Prompts 6-8):
//   resolveKitLineReference() pulls the upstream label + unit cost so
//   proposal generation can multiply factor × quantity and price the
//   resulting line item against current settings + catalog state.

import { supabase } from '@/lib/supabase'
import type {
  CatalogItem,
  CompanyEquipmentRate,
  CompanyLaborType,
  Kit,
  KitLine,
  KitLineResolved,
  KitStatus,
  KitWithLines,
} from '@/lib/types'

// ──────────────────────────────────────────────────────────────────────
// Kit header CRUD
// ──────────────────────────────────────────────────────────────────────

/**
 * Load every kit owned by the current user (active + archived).
 * Callers filter client-side — the list page needs both for the
 * Active/Archived toggle, and the result set is small (kits are
 * per-contractor, expected < 100).
 */
export async function loadKits(): Promise<Kit[]> {
  const { data, error } = await supabase
    .from('kits')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) {
    throw new Error(`Couldn't load kits: ${error.message}`)
  }
  return (data ?? []) as Kit[]
}

/**
 * Load a single kit + its ordered line items. Returns null when the
 * id doesn't exist for the current user (RLS makes it look the same
 * as "not found" — that's deliberate).
 */
export async function loadKit(id: string): Promise<KitWithLines | null> {
  const [{ data: kit, error: kitErr }, { data: lines, error: linesErr }] =
    await Promise.all([
      supabase.from('kits').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('kit_lines')
        .select('*')
        .eq('kit_id', id)
        .order('position', { ascending: true }),
    ])
  if (kitErr) {
    throw new Error(`Couldn't load kit: ${kitErr.message}`)
  }
  if (!kit) return null
  if (linesErr) {
    throw new Error(`Couldn't load kit lines: ${linesErr.message}`)
  }
  return { ...(kit as Kit), lines: (lines ?? []) as KitLine[] }
}

/**
 * Create a new kit. The header form (NewKitModal) collects the
 * required fields; Jamie notes is optional. Status defaults to
 * 'active' at the DB layer. Caller navigates to /app/kits/<id>
 * after creation to add line items.
 */
export async function createKit(
  input: Pick<
    Kit,
    'name' | 'category' | 'input_unit' | 'branch_scope' | 'jamie_notes'
  >
): Promise<Kit> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Not signed in.')
  }
  const { data, error } = await supabase
    .from('kits')
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      category: input.category.trim(),
      input_unit: input.input_unit.trim(),
      branch_scope: input.branch_scope?.trim() || null,
      jamie_notes: input.jamie_notes?.trim() || null,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't create kit: ${error?.message ?? 'no row returned'}`)
  }
  return data as Kit
}

/**
 * Patch a kit's header. Used by the Save bar on the detail page
 * (sticky Save+Reset, not save-on-blur). Strips server-managed fields.
 */
export async function updateKit(
  id: string,
  patch: Partial<Kit>
): Promise<Kit> {
  const {
    id: _id,
    user_id: _user_id,
    created_at: _created_at,
    updated_at: _updated_at,
    ...allowed
  } = patch
  void _id
  void _user_id
  void _created_at
  void _updated_at

  const { data, error } = await supabase
    .from('kits')
    .update(allowed)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save kit: ${error?.message ?? 'no row returned'}`)
  }
  return data as Kit
}

/**
 * Hard delete a kit. Cascade kills its kit_lines automatically. The
 * Danger Zone button on the detail page is the only caller.
 */
export async function deleteKit(id: string): Promise<void> {
  const { error } = await supabase.from('kits').delete().eq('id', id)
  if (error) {
    throw new Error(`Couldn't delete kit: ${error.message}`)
  }
}

/** Move a kit to archived status. Reversible via unarchiveKit. */
export async function archiveKit(id: string): Promise<Kit> {
  return updateKit(id, { status: 'archived' as KitStatus })
}

/** Restore an archived kit to active status. */
export async function unarchiveKit(id: string): Promise<Kit> {
  return updateKit(id, { status: 'active' as KitStatus })
}

/**
 * Duplicate a kit including all its lines. Useful for size-tiered
 * kits ("Standard" → duplicate → "Premium" with adjusted factors).
 * The copy gets a fresh id; lines get fresh ids; references are
 * preserved (point to the same upstream entities).
 */
export async function duplicateKit(id: string, newName: string): Promise<Kit> {
  const source = await loadKit(id)
  if (!source) {
    throw new Error('Source kit not found.')
  }
  // Create the new header
  const copy = await createKit({
    name: newName.trim(),
    category: source.category,
    input_unit: source.input_unit,
    branch_scope: source.branch_scope,
    jamie_notes: source.jamie_notes,
  })
  // Copy lines in a single insert for atomicity within the kit. RLS
  // requires kit_id ownership which is satisfied by the just-created
  // kit (same user).
  if (source.lines.length > 0) {
    const rows = source.lines.map((l) => ({
      kit_id: copy.id,
      position: l.position,
      type: l.type,
      display_name: l.display_name,
      reference_type: l.reference_type,
      reference_labor_type_id: l.reference_labor_type_id,
      reference_equipment_rate_id: l.reference_equipment_rate_id,
      reference_catalog_item_id: l.reference_catalog_item_id,
      factor: l.factor,
      factor_unit: l.factor_unit,
      notes: l.notes,
    }))
    const { error } = await supabase.from('kit_lines').insert(rows)
    if (error) {
      // Kit header created but lines failed — surface the partial state
      // rather than silently dropping. UI can offer Retry.
      throw new Error(
        `Kit header copied but lines failed: ${error.message}. Delete the partial copy and retry.`
      )
    }
  }
  return copy
}

// ──────────────────────────────────────────────────────────────────────
// Kit line CRUD
// ──────────────────────────────────────────────────────────────────────

/** Load lines for a kit ordered by position. Usually called via loadKit. */
export async function loadKitLines(kitId: string): Promise<KitLine[]> {
  const { data, error } = await supabase
    .from('kit_lines')
    .select('*')
    .eq('kit_id', kitId)
    .order('position', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load kit lines: ${error.message}`)
  }
  return (data ?? []) as KitLine[]
}

/**
 * Insert a new kit_line. Position should be set by the caller —
 * typically the count of existing lines (append at end).
 *
 * The caller is responsible for keeping `reference_type` and the
 * matching FK column consistent (the DB CHECK constraint enforces
 * this, so a mismatch throws here).
 */
export async function addKitLine(
  kitId: string,
  line: Omit<KitLine, 'id' | 'kit_id' | 'created_at' | 'updated_at'>
): Promise<KitLine> {
  const { data, error } = await supabase
    .from('kit_lines')
    .insert({
      kit_id: kitId,
      position: line.position,
      type: line.type,
      display_name: line.display_name,
      reference_type: line.reference_type,
      reference_labor_type_id: line.reference_labor_type_id,
      reference_equipment_rate_id: line.reference_equipment_rate_id,
      reference_catalog_item_id: line.reference_catalog_item_id,
      factor: line.factor,
      factor_unit: line.factor_unit,
      notes: line.notes,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't add line: ${error?.message ?? 'no row returned'}`)
  }
  return data as KitLine
}

/**
 * Patch a kit_line. Save bar diffs each modified line and calls this
 * for each one. When changing reference_type, the caller MUST also
 * clear the previously-set FK and set the new one — DB CHECK will
 * reject inconsistent rows.
 */
export async function updateKitLine(
  id: string,
  patch: Partial<KitLine>
): Promise<KitLine> {
  const {
    id: _id,
    kit_id: _kit_id,
    created_at: _created_at,
    updated_at: _updated_at,
    ...allowed
  } = patch
  void _id
  void _kit_id
  void _created_at
  void _updated_at

  const { data, error } = await supabase
    .from('kit_lines')
    .update(allowed)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save line: ${error?.message ?? 'no row returned'}`)
  }
  return data as KitLine
}

/** Hard delete a kit_line. Caller should resequence positions after. */
export async function deleteKitLine(id: string): Promise<void> {
  const { error } = await supabase.from('kit_lines').delete().eq('id', id)
  if (error) {
    throw new Error(`Couldn't delete line: ${error.message}`)
  }
}

/**
 * Rewrite position for every line in the supplied order. Used after
 * dnd-kit drag-drop reorder. Parallel updates inside Promise.all —
 * positions are independent so order of completion doesn't matter.
 */
export async function reorderKitLines(
  _kitId: string,
  lineIdsInOrder: string[]
): Promise<void> {
  const results = await Promise.all(
    lineIdsInOrder.map((id, idx) =>
      supabase.from('kit_lines').update({ position: idx }).eq('id', id)
    )
  )
  const firstErr = results.find((r) => r.error)
  if (firstErr?.error) {
    throw new Error(`Reorder failed: ${firstErr.error.message}`)
  }
}

// ──────────────────────────────────────────────────────────────────────
// Lookup helpers — populate the line-item reference dropdowns
// ──────────────────────────────────────────────────────────────────────

/**
 * Lightweight catalog list for the Material reference dropdown.
 * Returns active items only — archived items are excluded (you
 * shouldn't be able to reference a retired catalog item in a new
 * kit line). Existing kit_lines that already reference a now-inactive
 * catalog item keep their reference until edited.
 */
export async function loadCatalogItemsForKitLines(): Promise<
  Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
> {
  const { data, error } = await supabase
    .from('catalog_items')
    .select('id, name, category, unit, unit_cost')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load catalog items: ${error.message}`)
  }
  return (data ?? []) as Pick<
    CatalogItem,
    'id' | 'name' | 'category' | 'unit' | 'unit_cost'
  >[]
}

/**
 * Labor type slots for the Labor reference dropdown. Returns all 5
 * slots ordered by slot_number; UI hides slots where name is NULL
 * (un-configured) so the contractor sees only their named labor
 * types.
 */
export async function loadLaborTypesForKitLines(): Promise<
  Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
> {
  const { data, error } = await supabase
    .from('company_labor_types')
    .select('id, name, rate_per_hour, slot_number')
    .order('slot_number', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load labor types: ${error.message}`)
  }
  return (data ?? []) as Pick<
    CompanyLaborType,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
}

/**
 * Equipment rate slots for the Equipment reference dropdown. Same
 * pattern as labor types — 10 slots, UI hides un-named ones.
 */
export async function loadEquipmentRatesForKitLines(): Promise<
  Pick<CompanyEquipmentRate, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
> {
  const { data, error } = await supabase
    .from('company_equipment_rates')
    .select('id, name, rate_per_hour, slot_number')
    .order('slot_number', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load equipment rates: ${error.message}`)
  }
  return (data ?? []) as Pick<
    CompanyEquipmentRate,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
}

// ──────────────────────────────────────────────────────────────────────
// Reference resolution — used at proposal-creation time (Prompts 6+)
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolve a kit_line's upstream reference to a live label + unit cost.
 * Returns:
 *   • Label from the referenced entity (or the line's own display_name
 *     when reference_type='none')
 *   • Unit cost (rate_per_hour for labor/equipment, unit_cost for
 *     materials, null for sub/other)
 *   • reference_missing=true when reference_type names a kind but the
 *     FK is NULL (upstream was deleted via cascade SET NULL)
 *
 * This is the function Prompts 6-8 will call when generating proposal
 * line items from a kit + quantity. Each kit_line is resolved, then
 * the proposal layer multiplies factor × quantity and applies the
 * resolved unit cost + markup.
 *
 * Defined here even though Prompt 5 doesn't consume it yet — keeps
 * the contract close to the data and lets us write integration tests
 * before Prompt 6 lands.
 */
export async function resolveKitLineReference(
  line: KitLine
): Promise<KitLineResolved> {
  // No-reference lines (Sub / Other / placeholders) — return as-is
  if (line.reference_type === 'none') {
    return {
      ...line,
      resolved_label: line.display_name,
      resolved_unit_cost: null,
      reference_missing: false,
    }
  }

  // Reference declared but FK already NULL — upstream was deleted
  switch (line.reference_type) {
    case 'labor_type': {
      if (!line.reference_labor_type_id) {
        return {
          ...line,
          resolved_label: line.display_name,
          resolved_unit_cost: null,
          reference_missing: true,
        }
      }
      const { data, error } = await supabase
        .from('company_labor_types')
        .select('name, rate_per_hour')
        .eq('id', line.reference_labor_type_id)
        .maybeSingle()
      if (error) {
        throw new Error(`Couldn't resolve labor reference: ${error.message}`)
      }
      return {
        ...line,
        resolved_label: data?.name ?? line.display_name,
        resolved_unit_cost: data?.rate_per_hour ?? null,
        reference_missing: !data,
      }
    }
    case 'equipment_rate': {
      if (!line.reference_equipment_rate_id) {
        return {
          ...line,
          resolved_label: line.display_name,
          resolved_unit_cost: null,
          reference_missing: true,
        }
      }
      const { data, error } = await supabase
        .from('company_equipment_rates')
        .select('name, rate_per_hour')
        .eq('id', line.reference_equipment_rate_id)
        .maybeSingle()
      if (error) {
        throw new Error(
          `Couldn't resolve equipment reference: ${error.message}`
        )
      }
      return {
        ...line,
        resolved_label: data?.name ?? line.display_name,
        resolved_unit_cost: data?.rate_per_hour ?? null,
        reference_missing: !data,
      }
    }
    case 'catalog_item': {
      if (!line.reference_catalog_item_id) {
        return {
          ...line,
          resolved_label: line.display_name,
          resolved_unit_cost: null,
          reference_missing: true,
        }
      }
      const { data, error } = await supabase
        .from('catalog_items')
        .select('name, unit_cost')
        .eq('id', line.reference_catalog_item_id)
        .maybeSingle()
      if (error) {
        throw new Error(`Couldn't resolve material reference: ${error.message}`)
      }
      return {
        ...line,
        resolved_label: data?.name ?? line.display_name,
        resolved_unit_cost: data?.unit_cost ?? null,
        reference_missing: !data,
      }
    }
    default: {
      // Exhaustiveness — TS narrows to never if all cases handled
      const _exhaustive: never = line.reference_type
      void _exhaustive
      return {
        ...line,
        resolved_label: line.display_name,
        resolved_unit_cost: null,
        reference_missing: false,
      }
    }
  }
}
