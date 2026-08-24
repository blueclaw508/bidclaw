// backfill-ingest-markup — retrofit cost recovery onto estimates that were
// reverse-ingested BEFORE the unwind fix.
//
//   node scripts/backfill-ingest-markup.mjs              (dry run — default)
//   node scripts/backfill-ingest-markup.mjs --apply
//   node scripts/backfill-ingest-markup.mjs --apply --project <uuid>
//
// Those estimates carry the proposal's BILLED amount in unit_cost with
// markup_override pinned to 0, so every material line claims zero margin.
// This rewrites each markup-bearing line to unit_cost = billed / (1 + m/100)
// with markup_override = m — the same arithmetic commitIngestedProposal now
// does at write time. The customer-facing price does not move.
//
// IDENTIFYING AN INGESTED WORK AREA (this is the whole safety story):
// markup_override is NULL on a hand-built line — NULL means "use the live
// company markup". Reverse ingestion is the only thing in the codebase that
// writes an explicit 0 to EVERY line of a work area. So the signature is:
//   every line in the work area has a non-null markup_override, AND
//   at least one of them is 0, AND
//   the work area has a "General Conditions & Rounding" line.
// A hand-built work area fails the first clause immediately. A work area
// where the contractor deliberately overrode one line to 0% fails it too.
//
// Lines already carrying a real markup (the BCA pool-subcontractor rule at
// 10%) are left alone — their unit_cost is already a cost basis.
//
// Every work area is checked before and after: if the billed total would
// move by more than half a cent, that work area is SKIPPED and reported.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })
config({ path: '.env.local' })

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
const projectFilter = (() => {
  const i = process.argv.indexOf('--project')
  return i >= 0 ? process.argv[i + 1] : null
})()

const admin = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const money = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const BEARS_MARKUP = new Set(['material', 'subcontractor', 'other'])
const billedOf = (l) =>
  Number(l.quantity) * Number(l.unit_cost) * (1 + (Number(l.markup_override) || 0) / 100)

async function main() {
  // Markups per user — an estimate is unwound with ITS OWNER's numbers.
  const { data: settings } = await admin
    .from('company_settings')
    .select('user_id, markup_materials_percent, markup_subs_percent')
  const markupsByUser = new Map(
    (settings ?? []).map((s) => [
      s.user_id,
      {
        material: Number(s.markup_materials_percent) || 0,
        subs: Number(s.markup_subs_percent) || 0,
      },
    ])
  )
  const markupFor = (userId, cat) => {
    const m = markupsByUser.get(userId)
    if (!m) return 0
    if (cat === 'material') return m.material
    if (cat === 'subcontractor' || cat === 'other') return m.subs
    return 0
  }

  let projQ = admin.from('projects').select('id, user_id, name')
  if (projectFilter) projQ = projQ.eq('id', projectFilter)
  const { data: projects, error: projErr } = await projQ
  if (projErr) throw new Error(`projects: ${projErr.message}`)

  const plan = []
  let scannedWAs = 0

  for (const p of projects ?? []) {
    const { data: was } = await admin
      .from('work_areas')
      .select('id, name')
      .eq('project_id', p.id)
      .order('sequence_order')
    for (const wa of was ?? []) {
      const { data: lines } = await admin
        .from('work_area_lines')
        .select('id, category, label, quantity, unit_cost, markup_override, price_override')
        .eq('work_area_id', wa.id)
        .order('sort_order')
      if (!lines || lines.length === 0) continue
      scannedWAs++

      // ── Signature check ──────────────────────────────────────────
      const allExplicit = lines.every((l) => l.markup_override !== null)
      const anyZero = lines.some((l) => Number(l.markup_override) === 0)
      const hasGC = lines.some((l) => /general conditions/i.test(String(l.label ?? '')))
      if (!allExplicit || !anyZero || !hasGC) continue

      // Something to actually change?
      const targets = lines.filter(
        (l) =>
          BEARS_MARKUP.has(String(l.category)) &&
          Number(l.markup_override) === 0 &&
          !/general conditions/i.test(String(l.label ?? '')) &&
          l.price_override === null &&
          markupFor(p.user_id, String(l.category)) > 0 &&
          Number(l.unit_cost) > 0
      )
      if (targets.length === 0) continue

      const billedBefore = lines.reduce((a, l) => a + billedOf(l), 0)
      const edits = targets.map((l) => {
        const m = markupFor(p.user_id, String(l.category))
        const newCost = Math.round((Number(l.unit_cost) / (1 + m / 100)) * 100) / 100
        return { line: l, m, newCost }
      })

      // Rebalance the General Conditions line, exactly as
      // commitIngestedProposal does at write time. Dividing a billed amount
      // by (1 + m) and rounding to cents leaves a few cents of drift per
      // line; without this the whole work area gets skipped for moving the
      // customer's price by $0.05. GC is the plug that exists to absorb it,
      // and it stays at 0% markup so it can do so exactly.
      const gcLine = lines.find((l) => /general conditions/i.test(String(l.label ?? '')))
      const editById = new Map(edits.map((e) => [e.line.id, e]))
      const othersBilledAfter = lines.reduce((a, l) => {
        if (gcLine && l.id === gcLine.id) return a
        const e = editById.get(l.id)
        if (!e) return a + billedOf(l)
        return a + Number(l.quantity) * e.newCost * (1 + e.m / 100)
      }, 0)

      let gcEdit = null
      let billedAfter
      if (gcLine && gcLine.price_override === null) {
        const target = Math.round((billedBefore - othersBilledAfter) * 100) / 100
        gcEdit = { line: gcLine, m: 0, newCost: target, newQty: 1 }
        billedAfter = othersBilledAfter + target
      } else {
        billedAfter = othersBilledAfter + (gcLine ? billedOf(gcLine) : 0)
      }

      plan.push({
        project: p,
        wa,
        edits,
        gcEdit,
        billedBefore,
        billedAfter,
        drift: billedAfter - billedBefore,
        safe: Math.abs(billedAfter - billedBefore) < 0.005,
      })
    }
  }

  // ── Report ────────────────────────────────────────────────────────
  console.log(
    `\nScanned ${scannedWAs} work area${scannedWAs === 1 ? '' : 's'} · ${plan.length} look reverse-ingested and need cost recovery\n`
  )
  if (plan.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let lastProject = null
  for (const item of plan) {
    if (item.project.id !== lastProject) {
      console.log(`\n■ ${item.project.name}  (${item.project.id})`)
      lastProject = item.project.id
    }
    const flag = item.safe ? '' : '   ⚠ SKIPPED — price would move'
    console.log(`  └ ${item.wa.name}${flag}`)
    for (const e of item.edits) {
      const q = Number(e.line.quantity)
      console.log(
        `      ${String(e.line.label).slice(0, 44).padEnd(44)} ` +
          `${q} × ${money(Number(e.line.unit_cost))} + 0%  →  ${q} × ${money(e.newCost)} + ${e.m}%`
      )
    }
    if (item.gcEdit) {
      const g = item.gcEdit
      const wasBilled = Number(g.line.quantity) * Number(g.line.unit_cost)
      if (Math.abs(wasBilled - g.newCost) >= 0.005) {
        console.log(
          `      ${'General Conditions & Rounding (rebalance)'.padEnd(44)} ` +
            `${money(wasBilled)}  →  ${money(g.newCost)}`
        )
      }
    }
    console.log(
      `      billed ${money(item.billedBefore)} → ${money(item.billedAfter)}` +
        (item.safe ? '  (unchanged)' : `  DRIFT ${money(item.drift)}`)
    )
  }

  const safe = plan.filter((i) => i.safe)
  const skipped = plan.filter((i) => !i.safe)
  const lineCount = safe.reduce((a, i) => a + i.edits.length, 0)

  console.log('\n' + '─'.repeat(70))
  console.log(
    `${safe.length} work area${safe.length === 1 ? '' : 's'} · ${lineCount} line${lineCount === 1 ? '' : 's'} to rewrite` +
      (skipped.length ? ` · ${skipped.length} SKIPPED (price would move)` : '')
  )

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these changes.')
    return
  }

  let written = 0
  for (const item of safe) {
    for (const e of item.edits) {
      const { error } = await admin
        .from('work_area_lines')
        .update({ unit_cost: e.newCost, markup_override: e.m })
        .eq('id', e.line.id)
      if (error) throw new Error(`update ${e.line.id}: ${error.message}`)
      written++
    }
    // GC last, so the plug lands on top of the final line costs.
    if (item.gcEdit) {
      const g = item.gcEdit
      const { error } = await admin
        .from('work_area_lines')
        .update({ unit_cost: g.newCost, quantity: g.newQty, markup_override: 0 })
        .eq('id', g.line.id)
      if (error) throw new Error(`update GC ${g.line.id}: ${error.message}`)
    }
  }
  console.log(`\nAPPLIED — ${written} lines rewritten. Customer-facing totals unchanged.`)
}

main().catch((err) => {
  console.error('\nBACKFILL ERROR:', err.message)
  process.exit(1)
})
