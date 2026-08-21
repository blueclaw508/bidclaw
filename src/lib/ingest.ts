// Reverse-ingestion COMMIT (RI-commit) — turn a jamie-ingest
// reconstruction into a real BidClaw estimate + a Leads & Bids card.
//
// The estimate is built through the SAME columns manual creation uses, so
// the result is indistinguishable from a hand-built one. Line markup is
// pinned to 0 because the reconstruction already DECOMPOSED the
// contractor's final prices (margin is inside them) — so a work area's
// billed total = sum(qty x unit_cost) = the proposal's stated total.
//
// Client-agnostic on purpose: pass the browser supabase client from the
// UI, or a session-injected node client from the verify harness. Every
// insert runs under the caller's RLS.

import type { SupabaseClient } from '@supabase/supabase-js'

export type IngestCategory =
  | 'labor' | 'material' | 'equipment' | 'subcontractor' | 'other'
export type IngestKind =
  | 'base' | 'add_option' | 'deduct_option' | 'equipment_selection'

export interface IngestLine {
  category: IngestCategory
  label: string
  qty: number
  unit: string
  unit_cost: number
  /** Markup % BidClaw re-applies (0 for decomposed lines; 10 for BCA
   *  pool-subcontractor lines whose unit_cost is the de-marked cost). */
  markup_pct?: number
  reasoning?: string
  needs_pricing?: boolean
}
export interface IngestWorkArea {
  name: string
  scope_description: string
  stated_total: number
  kind: IngestKind
  line_items: IngestLine[]
  confidence?: string
  general_conditions_amount?: number
}
export interface IngestReconstruction {
  customer_name: string | null
  site_address: string | null
  proposal_date: string | null
  base_total: number
  work_areas: IngestWorkArea[]
  exclusions: string | null
  payment_terms: string | null
  ingest_notes?: string | null
}

export interface IngestCommitResult {
  projectId: string
  customerId: string | null
  leadId: string | null
  workAreaCount: number
  lineCount: number
  optionCount: number
}

/** Cape / Nantucket / Metro Boston from the site address (best-effort;
 *  editable on the lead card afterward). */
export function inferRegion(site: string | null): string | null {
  if (!site) return null
  const s = site.toLowerCase()
  if (s.includes('nantucket') || /\back\b/.test(s)) return 'NANTUCKET'
  if (
    /\b(boston|cambridge|somerville|newton|brookline|quincy|dedham|needham|wellesley|weston|milton)\b/.test(s)
  )
    return 'METRO BOSTON'
  if (
    /\b(dennis|osterville|barnstable|falmouth|mashpee|sandwich|bourne|yarmouth|harwich|chatham|orleans|brewster|eastham|wellfleet|truro|provincetown|cotuit|centerville|hyannis|marstons mills|cape cod)\b/.test(s) ||
    /\bma\s*02[5-6]\d\d\b/.test(s)
  )
    return 'CAPE COD'
  return null
}

/** Town from "59 Division Street, Dennis, MA 02639" → "Dennis". */
export function inferTown(site: string | null): string | null {
  if (!site) return null
  const parts = site.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    // The part just before the "MA 02xxx" chunk is the town.
    const stateIdx = parts.findIndex((p) => /^ma\b/i.test(p))
    const townPart = stateIdx > 0 ? parts[stateIdx - 1] : parts[parts.length - 2]
    return townPart.replace(/\s+ma.*/i, '').trim() || null
  }
  return null
}

export async function commitIngestedProposal(opts: {
  // deno-lint-ignore no-explicit-any
  client: SupabaseClient<any>
  userId: string
  proposalName: string
  reconstruction: IngestReconstruction
}): Promise<IngestCommitResult> {
  const { client, userId, reconstruction: r } = opts
  const base = r.work_areas.filter((w) => w.kind === 'base')
  const options = r.work_areas.filter((w) => w.kind !== 'base')
  const town = inferTown(r.site_address)
  const region = inferRegion(r.site_address)

  // 1 — Customer (when the proposal named one).
  let customerId: string | null = null
  if (r.customer_name?.trim()) {
    const { data: c, error } = await client
      .from('customers')
      .insert({
        user_id: userId,
        name: r.customer_name.trim(),
        site_address: r.site_address?.trim() || null,
        site_address_city: town,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Couldn't create customer: ${error.message}`)
    customerId = c.id as string
  }

  // 2 — Project/estimate. Options + terms + exclusions go to notes so
  //     nothing is lost while the base total stays exact.
  const notes: string[] = []
  if (options.length) {
    notes.push(
      'OPTIONS (not in base total):\n' +
        options
          .map((o) => `  • ${o.name} — $${Math.round(o.stated_total).toLocaleString()} (${o.kind})`)
          .join('\n')
    )
  }
  if (r.payment_terms) notes.push('PAYMENT TERMS: ' + r.payment_terms)
  if (r.exclusions) notes.push('EXCLUSIONS: ' + r.exclusions)
  notes.push(
    `Imported from an outside proposal via Jamie${r.proposal_date ? ` (dated ${r.proposal_date})` : ''}. Line detail was reconstructed backward to match the stated totals — review before sending.`
  )
  const { data: proj, error: pErr } = await client
    .from('projects')
    .insert({
      user_id: userId,
      customer_id: customerId,
      name: opts.proposalName,
      status: 'estimating',
      site_address_city: town,
      notes: notes.join('\n\n'),
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`Couldn't create estimate: ${pErr.message}`)
  const projectId = proj.id as string

  // 3 — Base work areas + their reconstructed lines (markup pinned to 0).
  let lineCount = 0
  for (let i = 0; i < base.length; i++) {
    const wa = base[i]
    const { data: waRow, error: waErr } = await client
      .from('work_areas')
      .insert({
        project_id: projectId,
        name: wa.name,
        description: wa.scope_description || null,
        sequence_order: i,
        estimate_status: 'approved',
      })
      .select('id')
      .single()
    if (waErr) throw new Error(`Couldn't create work area "${wa.name}": ${waErr.message}`)
    const waId = waRow.id as string
    const lines = wa.line_items.map((l, j) => ({
      work_area_id: waId,
      category: l.category as string,
      label: l.label,
      unit: l.unit || '',
      quantity: l.qty,
      unit_cost: l.unit_cost,
      price_override: null as number | null,
      // 0 for decomposed final-price lines; 10 for BCA pool-sub lines
      // (unit_cost = de-marked cost → billed = cost × 1.10 = stated).
      markup_override: l.markup_pct ?? 0,
      sort_order: j,
    }))
    // The stated total is Ian's real price — sacrosanct. Never trust the
    // model's arithmetic to hit it: RECOMPUTE the "General Conditions &
    // Rounding" balancer so billed sum == stated_total to the penny,
    // regardless of any slip in Jamie's line math.
    const billed = (l: (typeof lines)[number]) =>
      Number(l.quantity) * Number(l.unit_cost) * (1 + Number(l.markup_override) / 100)
    let gc = lines.find((l) => /general conditions/i.test(l.label))
    if (!gc) {
      gc = {
        work_area_id: waId, category: 'other', label: 'General Conditions & Rounding',
        unit: 'EA', quantity: 1, unit_cost: 0, price_override: null, markup_override: 0,
        sort_order: lines.length,
      }
      lines.push(gc)
    }
    gc.quantity = 1
    gc.markup_override = 0
    gc.unit_cost = 0
    const othersBilled = lines.filter((l) => l !== gc).reduce((a, l) => a + billed(l), 0)
    gc.unit_cost = Math.round((wa.stated_total - othersBilled) * 100) / 100
    if (lines.length) {
      const { error: lErr } = await client.from('work_area_lines').insert(lines)
      if (lErr) throw new Error(`Couldn't add lines to "${wa.name}": ${lErr.message}`)
      lineCount += lines.length
    }
  }

  // 4 — Leads & Bids card: value = the proposal's base total, region/town
  //     inferred. If a lead already exists for this project, enrich it.
  let leadId: string | null = null
  const { data: existing } = await client
    .from('leads')
    .select('id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (existing) {
    leadId = existing.id as string
    await client
      .from('leads')
      .update({ est_value: r.base_total, region, town })
      .eq('id', leadId)
  } else {
    const { data: lead, error: lErr } = await client
      .from('leads')
      .insert({
        user_id: userId,
        name: r.customer_name?.trim() || null,
        project_name: opts.proposalName,
        description: base[0]?.name ?? null,
        stage: 'estimating',
        project_id: projectId,
        est_value: r.base_total,
        region,
        town,
      })
      .select('id')
      .single()
    if (lErr) throw new Error(`Couldn't add to Leads & Bids: ${lErr.message}`)
    leadId = lead.id as string
  }

  return {
    projectId,
    customerId,
    leadId,
    workAreaCount: base.length,
    lineCount,
    optionCount: options.length,
  }
}
