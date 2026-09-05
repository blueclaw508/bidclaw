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

  let body: { mode?: string; year?: number; divisions?: number[] }
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

  const wanted = Array.isArray(body.divisions)
    ? [...new Set(body.divisions.filter((n) => Number.isInteger(n) && n >= 0))]
    : []

  if (body.year === undefined || wanted.length === 0) {
    return json({ catalogue })
  }

  // ── Map the chosen divisions ────────────────────────────────────────
  const model = models.find((m) => m.year === body.year)
  if (!model) return json({ error: 'No Know Your Numbers model for that year.' }, 404)
  const divisions = ((model.data ?? {}) as KynModel).divisions ?? []

  const chosen: Array<{ index: number; mapped: Mapped }> = []
  for (const idx of wanted) {
    const div = divisions[idx]
    if (!div) return json({ error: `No division ${idx} in that model.` }, 404)
    chosen.push({ index: idx, mapped: mapDivision(div) })
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Existing BidClaw divisions, so a repeat import updates the one it made
  // last time rather than stacking a second copy beside it.
  const { data: existingDivs } = await service
    .from('company_divisions')
    .select('id, name, sort_order, kyn_year, kyn_division_index')
    .eq('user_id', user.id)
  const divRows = existingDivs ?? []

  const findDivision = (kynIndex: number, name: string) =>
    divRows.find(
      (d) => d.kyn_year === body.year && d.kyn_division_index === kynIndex
    ) ?? divRows.find((d) => d.name === name)

  // ── What would change ───────────────────────────────────────────────
  const [{ data: allLabor }, { data: allEquip }] = await Promise.all([
    service
      .from('company_labor_types')
      .select('id, slot_number, division_id')
      .eq('user_id', user.id)
      .order('slot_number'),
    service
      .from('company_equipment_rates')
      .select('id, slot_number, division_id')
      .eq('user_id', user.id)
      .order('slot_number'),
  ])
  const labRows = allLabor ?? []
  const eqRows = allEquip ?? []

  const plans = chosen.map(({ index, mapped }) => {
    const target = findDivision(index, mapped.divisionName)
    const inDivLabor = target
      ? labRows.filter((r) => r.division_id === target.id)
      : []
    const inDivEquip = target
      ? eqRows.filter((r) => r.division_id === target.id)
      : []
    return {
      kynIndex: index,
      division: mapped.divisionName,
      isNewDivision: !target,
      labor: {
        incoming: mapped.labor,
        overwrites: Math.min(mapped.labor.length, inDivLabor.length),
        appends: Math.max(0, mapped.labor.length - inDivLabor.length),
        untouched: Math.max(0, inDivLabor.length - mapped.labor.length),
      },
      equipment: {
        incoming: mapped.equipment,
        overwrites: Math.min(mapped.equipment.length, inDivEquip.length),
        appends: Math.max(0, mapped.equipment.length - inDivEquip.length),
        untouched: Math.max(0, inDivEquip.length - mapped.equipment.length),
      },
      unmappedMarkups: mapped.unmappedMarkups,
    }
  })

  // Markups are COMPANY-level in BidClaw and per-division in KYN, so
  // importing several divisions cannot bring several markup pairs. The
  // first selected division supplies them, and the preview says which —
  // silently averaging or last-write-wins would be worse than naming it.
  const markupSource = chosen[0]
  const markupPlan = {
    fromDivision: markupSource.mapped.divisionName,
    materials: markupSource.mapped.markupMaterials,
    subs: markupSource.mapped.markupSubs,
  }

  if (mode === 'preview') return json({ catalogue, plans, markupPlan })

  // ── Apply ───────────────────────────────────────────────────────────
  // Never DELETES a rate row: kit_lines reference these with ON DELETE SET
  // NULL, so a full replace would quietly unlink every kit already built.
  // Overwrites within the division in order, appends the remainder.
  let nextLaborSlot = labRows.reduce((m, r) => Math.max(m, r.slot_number), 0)
  let nextEquipSlot = eqRows.reduce((m, r) => Math.max(m, r.slot_number), 0)
  let nextDivSort = divRows.reduce((m, d) => Math.max(m, d.sort_order), 0)

  try {
    for (const { index, mapped } of chosen) {
      // Find or create the BidClaw division.
      let target = findDivision(index, mapped.divisionName)
      if (!target) {
        nextDivSort += 1
        const { data: created, error } = await service
          .from('company_divisions')
          .insert({
            user_id: user.id,
            name: mapped.divisionName,
            sort_order: nextDivSort,
            kyn_year: body.year,
            kyn_division_index: index,
          })
          .select('id, name, sort_order, kyn_year, kyn_division_index')
          .single()
        if (error || !created) {
          throw new Error(`division "${mapped.divisionName}": ${error?.message}`)
        }
        target = created
        divRows.push(created)
      } else if (target.kyn_year === null) {
        // Matched by name on a division the contractor made themselves —
        // record the provenance so the next import updates this one.
        await service
          .from('company_divisions')
          .update({ kyn_year: body.year, kyn_division_index: index })
          .eq('id', target.id)
      }

      const divisionId = target.id

      const writeRows = async (
        table: 'company_labor_types' | 'company_equipment_rates',
        incoming: MappedRow[],
        existing: Array<{ id: string; slot_number: number; division_id: string | null }>,
        bumpSlot: () => number
      ) => {
        const mine = existing.filter((r) => r.division_id === divisionId)
        for (let i = 0; i < incoming.length; i++) {
          const row = incoming[i]
          const hit = mine[i]
          if (hit) {
            const { error } = await service
              .from(table)
              .update({ name: row.name, rate_per_hour: row.rate })
              .eq('id', hit.id)
            if (error) throw new Error(`${table}: ${error.message}`)
          } else {
            const { error } = await service.from(table).insert({
              user_id: user.id,
              slot_number: bumpSlot(),
              name: row.name,
              rate_per_hour: row.rate,
              division_id: divisionId,
            })
            if (error) throw new Error(`${table}: ${error.message}`)
          }
        }
      }

      await writeRows('company_labor_types', mapped.labor, labRows, () => ++nextLaborSlot)
      await writeRows('company_equipment_rates', mapped.equipment, eqRows, () => ++nextEquipSlot)
    }

    const patch: Record<string, number> = {}
    if (markupPlan.materials !== null)
      patch.markup_materials_percent = markupPlan.materials
    if (markupPlan.subs !== null) patch.markup_subs_percent = markupPlan.subs
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
    return json(
      { error: "Couldn't finish the import. Some divisions may have been imported already — re-run it to finish." },
      500
    )
  }

  return json({ applied: true, plans, markupPlan })
})
