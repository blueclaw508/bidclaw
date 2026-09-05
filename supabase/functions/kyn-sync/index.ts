// kyn-sync — pull a contractor's Know Your Numbers model into BidClaw.
//
// WHY THIS EXISTS. A comped KYN subscriber signs into BidClaw and finds a
// blank system: no labor rates, no equipment rates, no markups. They have
// already done that work — in KYN, which is where the methodology lives.
// Making them retype it is the difference between a good first session and
// a bad one.
//
// WHAT IT IS NOT: a copy. KYN stores equipment as an OWNERSHIP COST MODEL
// (price, salvage, years, hours, fuel, repairs) and BidClaw stores one
// hourly number. Deriving that number IS the KYN methodology, so the
// formula below is ported verbatim from kyn-engine/src/modules/equipment.ts
// — cell references and all — rather than reinvented. Getting it subtly
// wrong would silently mis-price every estimate the machine touches, in a
// product whose entire promise is that the numbers are right.
//
// CROSS-PROJECT ACCESS. KYN is a separate Supabase project with a separate
// user pool, so this reads it with KYN_SERVICE_ROLE_KEY. That key grants
// full access to KYN and is why this function does exactly two things with
// it — find one user by email, read that user's models — and never accepts
// an identifier from the caller. The tighter alternative is a narrow
// read-only endpoint on the KYN side; this is the version that needs no
// changes to a second product.
//
// NON-DESTRUCTIVE. Apply overwrites matching slots and appends new ones. It
// never DELETES a rate row, because kit_lines references those with ON
// DELETE SET NULL — a full replace would quietly unlink every kit the
// contractor had already built.

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/* ────────────────────────────────────────────────────────────────────
 * The KYN model, as stored in kyn-online public.models.data
 * ──────────────────────────────────────────────────────────────────── */

interface KynCrew {
  name?: string
  billRate?: number
}

interface KynEquipment {
  name?: string
  qty?: number
  price?: number
  years?: number
  salvage?: number
  licenses?: number
  insurance?: number
  tires?: number
  oil?: number
  repair?: number
  gallons?: number
  months?: number
  hrsPerWeek?: number
}

interface KynDivision {
  name?: string
  crews?: KynCrew[]
  equipment?: KynEquipment[]
  /** PERCENT, not a decimal — KYN's own state.ts divides by 100. */
  equipMarkupPct?: number
  avgFuelCost?: number
  markups?: {
    materials?: number
    subs?: number
    disposal?: number
    freight?: number
    other?: number
  }
}

interface KynModel {
  companyName?: string
  year?: number
  divisions?: KynDivision[]
}

/* ────────────────────────────────────────────────────────────────────
 * The equipment rate, ported verbatim from KYN
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Equipment billable hours use 4 weeks/month, NOT 4.33 (EQ Calculator
 * `S = Q*R*4*C`). A deliberate workbook distinction from labor, preserved
 * here because changing it would change every equipment rate by 8%.
 */
const WEEKS_PER_MONTH_EQUIPMENT = 4

/**
 * Ported from kyn-engine/src/modules/equipment.ts, itself ported verbatim
 * from the EQ Calculator sheet (row 8):
 *
 *   depreciationEach   G = IFERROR((D-F)/E, 0)
 *   totalDepreciation  H = G*C
 *   annualOperating    O = I+J+K+L+M+(N*$M$4)
 *   totalAnnualCost    P = H+O
 *   totAnnBillableHrs  S = Q*R*4*C
 *   hourlyCostOperate  T = IFERROR(P/S, 0)
 *   markupDollars      U = T*$F$4
 *   perHrCharge        V = T+U
 *
 * BidClaw wants perHrCharge, not hourlyCostToOperate: money.ts applies 0%
 * markup to equipment lines because "KYN — rates already include margin".
 * Importing the cost instead would under-bill every machine by the markup.
 */
function equipmentPerHourCharge(
  u: KynEquipment,
  markupOnEquip: number,
  avgFuelCost: number
): number {
  const n = (v: number | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const qty = n(u.qty)
  const years = n(u.years)

  const depreciationEach = years !== 0 ? (n(u.price) - n(u.salvage)) / years : 0
  const totalDepreciation = depreciationEach * qty
  const annualOperatingCost =
    n(u.licenses) +
    n(u.insurance) +
    n(u.tires) +
    n(u.oil) +
    n(u.repair) +
    n(u.gallons) * avgFuelCost
  const totalAnnualCost = totalDepreciation + annualOperatingCost
  const totalAnnualBillableHrs =
    n(u.months) * n(u.hrsPerWeek) * WEEKS_PER_MONTH_EQUIPMENT * qty
  const hourlyCostToOperate =
    totalAnnualBillableHrs !== 0 ? totalAnnualCost / totalAnnualBillableHrs : 0
  return hourlyCostToOperate + hourlyCostToOperate * markupOnEquip
}

/** Cents-accurate rounding, matching BidClaw's money convention. */
const round2 = (v: number) => Math.round(v * 100) / 100

interface MappedRow {
  name: string
  rate: number
}

interface Mapped {
  divisionName: string
  labor: MappedRow[]
  equipment: MappedRow[]
  markupMaterials: number | null
  markupSubs: number | null
  /** Markups KYN carries that BidClaw has nowhere to put. Reported, not dropped silently. */
  unmappedMarkups: Record<string, number>
}

function mapDivision(div: KynDivision): Mapped {
  const markupOnEquip = (div.equipMarkupPct ?? 0) / 100
  const avgFuelCost = div.avgFuelCost ?? 0

  const labor: MappedRow[] = (div.crews ?? [])
    .filter((c) => (c.name ?? '').trim() !== '')
    .map((c) => ({ name: (c.name ?? '').trim(), rate: round2(c.billRate ?? 0) }))

  const equipment: MappedRow[] = (div.equipment ?? [])
    .filter((e) => (e.name ?? '').trim() !== '')
    .map((e) => ({
      name: (e.name ?? '').trim(),
      rate: round2(equipmentPerHourCharge(e, markupOnEquip, avgFuelCost)),
    }))

  const m = div.markups ?? {}
  const unmapped: Record<string, number> = {}
  for (const k of ['disposal', 'freight', 'other'] as const) {
    const v = m[k]
    if (typeof v === 'number' && v !== 0) unmapped[k] = v
  }

  return {
    divisionName: (div.name ?? '').trim() || 'Unnamed division',
    labor,
    equipment,
    markupMaterials: typeof m.materials === 'number' ? m.materials : null,
    markupSubs: typeof m.subs === 'number' ? m.subs : null,
    unmappedMarkups: unmapped,
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Handler
 * ──────────────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const kynUrl = Deno.env.get('KYN_SUPABASE_URL')
  const kynKey = Deno.env.get('KYN_SERVICE_ROLE_KEY')
  if (!kynUrl || !kynKey) {
    return json(
      {
        error:
          'Know Your Numbers is not connected yet. Ask Ian to set KYN_SUPABASE_URL and KYN_SERVICE_ROLE_KEY.',
      },
      503
    )
  }

  // ── Who is asking ───────────────────────────────────────────────────
  // The email comes from THEIR verified JWT, never from the request body.
  // That is the whole access control here: a caller cannot ask for someone
  // else's numbers because they cannot name someone else.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  )
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user?.email) return json({ error: 'Not signed in.' }, 401)
  const email = user.email.trim().toLowerCase()

  let body: { mode?: string; year?: number; division?: number }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const mode = body.mode === 'apply' ? 'apply' : 'preview'

  // ── Find them in KYN ────────────────────────────────────────────────
  const kyn = createClient(kynUrl, kynKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // auth.users is not reachable through PostgREST, so this uses the admin
  // API and pages until the address turns up. Fine at KYN's current size;
  // if that list ever gets long this is the thing to replace with a
  // dedicated lookup on the KYN side.
  let kynUserId: string | null = null
  for (let page = 1; page <= 20 && !kynUserId; page++) {
    const { data, error } = await kyn.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('kyn-sync: listUsers failed:', error.message)
      return json({ error: "Couldn't reach Know Your Numbers." }, 502)
    }
    const users = data?.users ?? []
    if (users.length === 0) break
    const hit = users.find((u) => (u.email ?? '').trim().toLowerCase() === email)
    if (hit) kynUserId = hit.id
  }

  if (!kynUserId) {
    return json(
      {
        error:
          "We couldn't find a Know Your Numbers account under this email address.",
        code: 'NO_KYN_ACCOUNT',
      },
      404
    )
  }

  const { data: models, error: modelErr } = await kyn
    .from('models')
    .select('year, company_name, data, updated_at')
    .eq('user_id', kynUserId)
    .order('year', { ascending: false })
  if (modelErr) {
    console.error('kyn-sync: models read failed:', modelErr.message)
    return json({ error: "Couldn't read your Know Your Numbers model." }, 502)
  }
  if (!models || models.length === 0) {
    return json(
      { error: 'That Know Your Numbers account has no saved model yet.', code: 'NO_MODEL' },
      404
    )
  }

  // ── Discovery: what do they have? ───────────────────────────────────
  // Every division is listed, including maintenance ones. BidClaw is a
  // construction estimator (maintenance is RouteClaw's job), so the choice
  // is put in front of the contractor rather than guessed at by matching
  // names — "Maintanence" is misspelled in real data, and a heuristic that
  // silently imported the wrong division would be worse than asking.
  const catalogue = models.map((m) => {
    const d = (m.data ?? {}) as KynModel
    return {
      year: m.year as number,
      company_name: (m.company_name as string) ?? (d.companyName ?? ''),
      updated_at: m.updated_at as string,
      divisions: (d.divisions ?? []).map((div, i) => ({
        index: i,
        name: (div.name ?? '').trim() || `Division ${i + 1}`,
        crews: (div.crews ?? []).filter((c) => (c.name ?? '').trim() !== '').length,
        equipment: (div.equipment ?? []).filter((e) => (e.name ?? '').trim() !== '')
          .length,
      })),
    }
  })

  if (body.year === undefined || body.division === undefined) {
    return json({ catalogue })
  }

  // ── Map one division ────────────────────────────────────────────────
  const model = models.find((m) => m.year === body.year)
  if (!model) return json({ error: 'No Know Your Numbers model for that year.' }, 404)
  const divisions = ((model.data ?? {}) as KynModel).divisions ?? []
  const div = divisions[body.division]
  if (!div) return json({ error: 'No such division in that model.' }, 404)

  const mapped = mapDivision(div)

  // ── What would change ───────────────────────────────────────────────
  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const [{ data: existingLabor }, { data: existingEquip }] = await Promise.all([
    service
      .from('company_labor_types')
      .select('id, slot_number, name, rate_per_hour')
      .eq('user_id', user.id)
      .order('slot_number'),
    service
      .from('company_equipment_rates')
      .select('id, slot_number, name, rate_per_hour')
      .eq('user_id', user.id)
      .order('slot_number'),
  ])
  const labRows = existingLabor ?? []
  const eqRows = existingEquip ?? []

  const plan = {
    division: mapped.divisionName,
    labor: {
      incoming: mapped.labor,
      overwrites: Math.min(mapped.labor.length, labRows.length),
      appends: Math.max(0, mapped.labor.length - labRows.length),
      untouched: Math.max(0, labRows.length - mapped.labor.length),
    },
    equipment: {
      incoming: mapped.equipment,
      overwrites: Math.min(mapped.equipment.length, eqRows.length),
      appends: Math.max(0, mapped.equipment.length - eqRows.length),
      untouched: Math.max(0, eqRows.length - mapped.equipment.length),
    },
    markupMaterials: mapped.markupMaterials,
    markupSubs: mapped.markupSubs,
    unmappedMarkups: mapped.unmappedMarkups,
  }

  if (mode === 'preview') return json({ catalogue, plan })

  // ── Apply ───────────────────────────────────────────────────────────
  // In place by slot, appending what does not fit. Never deletes: kit_lines
  // point at these rows with ON DELETE SET NULL, so removing one would
  // quietly unlink kits the contractor has already built.
  const writeRows = async (
    table: 'company_labor_types' | 'company_equipment_rates',
    incoming: MappedRow[],
    existing: Array<{ id: string; slot_number: number }>
  ) => {
    let nextSlot = existing.reduce((m, r) => Math.max(m, r.slot_number), 0)
    for (let i = 0; i < incoming.length; i++) {
      const row = incoming[i]
      const target = existing[i]
      if (target) {
        const { error } = await service
          .from(table)
          .update({ name: row.name, rate_per_hour: row.rate })
          .eq('id', target.id)
        if (error) throw new Error(`${table}: ${error.message}`)
      } else {
        nextSlot += 1
        const { error } = await service.from(table).insert({
          user_id: user.id,
          slot_number: nextSlot,
          name: row.name,
          rate_per_hour: row.rate,
        })
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    }
  }

  try {
    await writeRows('company_labor_types', mapped.labor, labRows)
    await writeRows('company_equipment_rates', mapped.equipment, eqRows)

    const patch: Record<string, number> = {}
    if (mapped.markupMaterials !== null)
      patch.markup_materials_percent = mapped.markupMaterials
    if (mapped.markupSubs !== null) patch.markup_subs_percent = mapped.markupSubs
    if (Object.keys(patch).length > 0) {
      const { error } = await service
        .from('company_settings')
        .update(patch)
        .eq('user_id', user.id)
      if (error) throw new Error(`company_settings: ${error.message}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('kyn-sync apply failed:', msg)
    return json({ error: "Couldn't finish the import. Nothing else was changed." }, 500)
  }

  return json({ applied: true, plan })
})
