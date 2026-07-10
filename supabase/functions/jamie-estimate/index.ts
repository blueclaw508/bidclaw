// jamie-estimate — Jamie's brain (BidClaw AI estimating agent, Phase 1).
//
// Prices ONE work area from a scope description. Jamie is a PAID UPGRADE:
// this function enforces company_settings.jamie_enabled server-side (403
// if off) so the manual system stays free and nobody hits the paid AI by
// calling the endpoint directly.
//
// Flow: verify JWT -> enforce entitlement -> assemble the contractor's
// KYN context (catalog + labor/equipment rates + markups) -> one Claude
// call returning structured JSON (scope + line items + gaps + new items)
// -> log the run -> return JSON. The CLIENT inserts the lines (RLS-safe).
//
// Prime directive (BidClaw SKILL): every item in the scope description
// MUST have a line item, and vice versa. Scope and line items match 100%.

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = 'claude-opus-4-8'

// J1c — metering rider: legacy Phase-1 calls now ALSO record into
// jamie_invocations (recording only, founder-mode, no enforcement here;
// jamie_run_id stays NULL = legacy single-shot row, see migration 0023).
// $/1M verified 2026-07-10: Opus 4.8 $5 in / $25 out; cache writes bill
// 1.25× input, cache reads 0.1×.
const PRICE_IN = 5
const PRICE_OUT = 25
// deno-lint-ignore no-explicit-any
function legacyCostUsd(u: any): number | null {
  if (!u) return null
  const usd =
    ((u.input_tokens ?? 0) * PRICE_IN +
      (u.cache_creation_input_tokens ?? 0) * 1.25 * PRICE_IN +
      (u.cache_read_input_tokens ?? 0) * 0.1 * PRICE_IN +
      (u.output_tokens ?? 0) * PRICE_OUT) /
    1_000_000
  return Math.round(usd * 10_000) / 10_000
}

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

// ── Jamie's structured-output contract ────────────────────────────────
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scope_description', 'line_items', 'gap_questions', 'new_catalog_items'],
  properties: {
    scope_description: { type: 'string' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'unit', 'category', 'unit_cost'],
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string' },
          category: {
            type: 'string',
            enum: ['Materials', 'Equipment', 'Labor', 'Subcontractor', 'Other'],
          },
          // BASE cost per unit. Materials/Sub/Other: the catalog cost
          // (markup is applied by the app, NOT here). Labor/Equipment:
          // the $/hr rate. 0 when Jamie can't price it (see new_catalog_items).
          unit_cost: { type: 'number' },
        },
      },
    },
    gap_questions: { type: 'array', items: { type: 'string' } },
    new_catalog_items: { type: 'array', items: { type: 'string' } },
  },
} as const

// ── System prompt (KYN, estimate-first, single work area) ─────────────
function buildSystemPrompt(ctx: {
  companyName: string
  materialsMarkup: number
  subsMarkup: number
  laborTypes: Array<{ name: string; rate: number }>
  equipmentRates: Array<{ name: string; rate: number }>
  catalog: Array<{ name: string; unit: string; category: string; cost: number }>
}): string {
  const lt = ctx.laborTypes.length
    ? ctx.laborTypes.map((l) => `  - ${l.name}: $${l.rate}/hr`).join('\n')
    : '  (none configured — put labor at unit_cost 0 and flag it)'
  const eq = ctx.equipmentRates.length
    ? ctx.equipmentRates.map((e) => `  - ${e.name}: $${e.rate}/hr`).join('\n')
    : '  (none configured — put equipment at unit_cost 0 and flag it)'
  const byCat: Record<string, string[]> = {}
  for (const c of ctx.catalog) {
    ;(byCat[c.category] ??= []).push(`  - ${c.name} (${c.unit}): $${c.cost} base cost`)
  }
  const cat = Object.keys(byCat).length
    ? Object.entries(byCat)
        .map(([k, v]) => `${k}:\n${v.join('\n')}`)
        .join('\n')
    : '  (empty — price from your trade knowledge and flag every item as new)'

  return `You are Jamie, ${ctx.companyName ? ctx.companyName + "'s" : "the contractor's"} estimating agent inside BidClaw. You are trained on the Know Your Numbers (KYN) framework. You are a sharp estimator who has done this a thousand times. Short sentences. No corporate jargon.

You estimate ONE work area at a time. The contractor gives you a scope; you produce the complete, priced line-item takeoff for that ONE work area.

PRIME DIRECTIVE: Every component you mention in the scope description MUST have a matching line item, and every line item MUST be reflected in the scope. Scope and line items match 100%. If you write it, you bill it.

Work the KYN steps in order for this work area:
1. MATERIAL TAKEOFF — every physical material that goes into the job is a line item. Stone veneer means stone AND mortar AND lath AND barrier AND fasteners AND weep screed AND corners — not just stone. Include ~10% waste on area/volume materials.
2. EQUIPMENT — every piece of equipment is its own line, billed by the hour (cement mixer, grinder, plate compactor, excavator).
3. LABOR — project man-hours. A full crew day = 27 man-hours (3 crew x 9 hrs). Round UP to a full day if within 20% of 27 hrs. Half day = 13-14 hrs.
4. GENERAL CONDITIONS — always add one "General Conditions & Rounding" line (category Other) for incidentals/rounding.
5. SCOPE NOTES — step-by-step bullets describing exactly what will be done. Every bullet maps to line items above.

PRICING RULES — use THIS contractor's numbers, given below:
- Labor lines: qty = man-hours; unit_cost = the $/hr rate of the best-matching labor type below.
- Equipment lines: qty = hours; unit_cost = the $/hr rate of the best-matching equipment rate below.
- Materials / Subcontractor / Other lines: unit_cost = the BASE cost per unit. If the item is in the catalog below, use that cost. If it is NOT in the catalog, set unit_cost to 0 and add the item's name to new_catalog_items. Do NOT apply markup yourself — the app applies the contractor's markup automatically. (Materials markup ${ctx.materialsMarkup}%, Subs/Other markup ${ctx.subsMarkup}% — for your awareness only; never bake it into unit_cost.)

THIS CONTRACTOR'S KYN NUMBERS
Labor rates ($/hr):
${lt}
Equipment rates ($/hr):
${eq}
Item catalog (base costs — markup is automatic, do not add it):
${cat}

If something critical is ambiguous (substrate, disposal included, owned vs rented, Nantucket logistics, stone profile), add it to gap_questions — but still produce your best-estimate line items now; don't stall.

Categories must be exactly: Materials, Equipment, Labor, Subcontractor, Other.`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // 1. Who's calling?
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Not signed in.' }, 401)

  // 2. Parse input.
  let body: {
    workAreaId?: string
    workAreaName?: string
    scope?: string
    image?: { media_type: string; data: string } | null
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const scope = (body.scope ?? '').trim()
  if (!scope) return json({ error: 'Describe the scope so Jamie has something to work with.' }, 400)

  // 3. Entitlement — Jamie is a paid upgrade. Server-side gate.
  const { data: settings, error: setErr } = await supabase
    .from('company_settings')
    .select('jamie_enabled, company_legal_name, markup_materials_percent, markup_subs_percent')
    .single()
  if (setErr || !settings) return json({ error: 'Could not load your settings.' }, 500)
  if (!settings.jamie_enabled) {
    return json(
      { error: 'Jamie is a paid upgrade and is not enabled on your account.', code: 'jamie_not_enabled' },
      403
    )
  }

  // 4. Assemble the contractor's KYN context (all RLS-scoped to the user).
  const [{ data: labor }, { data: equip }, { data: catalog }] = await Promise.all([
    supabase.from('company_labor_types').select('name, rate_per_hour').order('slot_number'),
    supabase.from('company_equipment_rates').select('name, rate_per_hour').order('slot_number'),
    supabase.from('catalog_items').select('name, unit, category, unit_cost').eq('active', true),
  ])

  const laborTypes = (labor ?? [])
    .filter((l) => l.name && Number(l.rate_per_hour) > 0)
    .map((l) => ({ name: l.name as string, rate: Number(l.rate_per_hour) }))
  const equipmentRates = (equip ?? [])
    .filter((e) => e.name && Number(e.rate_per_hour) > 0)
    .map((e) => ({ name: e.name as string, rate: Number(e.rate_per_hour) }))
  const catalogItems = (catalog ?? []).map((c) => ({
    name: c.name as string,
    unit: (c.unit as string) ?? '',
    category: (c.category as string) ?? 'other',
    cost: Number(c.unit_cost) || 0,
  }))

  const system = buildSystemPrompt({
    companyName: (settings.company_legal_name as string) ?? '',
    materialsMarkup: Number(settings.markup_materials_percent) || 0,
    subsMarkup: Number(settings.markup_subs_percent) || 0,
    laborTypes,
    equipmentRates,
    catalog: catalogItems,
  })

  // 5. Build the user turn (scope + optional photo/sketch via vision).
  const userContent: Anthropic.ContentBlockParam[] = []
  if (body.image?.data && body.image?.media_type) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: body.image.media_type as never, data: body.image.data },
    })
  }
  userContent.push({
    type: 'text',
    text: `Work area: ${body.workAreaName ?? 'Untitled'}\n\nScope from the contractor:\n${scope}`,
  })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'Jamie is not configured (missing API key).' }, 500)
  const anthropic = new Anthropic({ apiKey })

  // 6. Call Claude. Adaptive thinking (estimating IS reasoning) + structured
  //    output (the text block is guaranteed valid JSON matching OUTPUT_SCHEMA).
  //    Non-streaming: a single work area's estimate is small and max_tokens
  //    (12k) is under the streaming threshold, so no HTTP-timeout risk.
  const startedAt = new Date().toISOString() // J1c metering
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 12000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system,
      messages: [{ role: 'user', content: userContent }],
    }
    const message = await anthropic.messages.create(params)

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Jamie returned no estimate.')
    }
    const parsed = JSON.parse(textBlock.text)

    // 7. Log the run (best-effort; a log failure never blocks the estimate).
    await supabase.from('jamie_runs').insert({
      user_id: user.id,
      work_area_id: body.workAreaId ?? null,
      scope_input: scope,
      had_image: !!body.image?.data,
      model: MODEL,
      status: 'ok',
      result: parsed,
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
    })

    // J1c metering (recording only): outcome 'committed' = estimate
    // delivered (single-shot has no approval gates). counts_against_quota
    // stays FALSE — founder-mode records, never enforces.
    await supabase.from('jamie_invocations').insert({
      user_id: user.id,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      model_used: MODEL,
      input_tokens:
        (message.usage?.input_tokens ?? 0) +
        (message.usage?.cache_creation_input_tokens ?? 0),
      output_tokens: message.usage?.output_tokens ?? 0,
      cached_input_tokens: message.usage?.cache_read_input_tokens ?? 0,
      estimated_cost_usd: legacyCostUsd(message.usage),
      image_count: body.image?.data ? 1 : 0,
      outcome: 'committed',
    })

    return json(parsed)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Jamie hit a snag.'
    await supabase.from('jamie_runs').insert({
      user_id: user.id,
      work_area_id: body.workAreaId ?? null,
      scope_input: scope,
      had_image: !!body.image?.data,
      model: MODEL,
      status: 'error',
      error: msg,
    })
    // J1c metering: failed calls record too (cost data includes waste).
    await supabase.from('jamie_invocations').insert({
      user_id: user.id,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      model_used: MODEL,
      image_count: body.image?.data ? 1 : 0,
      outcome: 'error',
    })
    return json({ error: `Jamie hit a snag — ${msg}. Try again or adjust your scope.` }, 502)
  }
})
