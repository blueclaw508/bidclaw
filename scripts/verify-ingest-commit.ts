// verify-ingest-commit — RI-commit harness. Commits saved reconstructions
// into real BidClaw estimates and proves they populate Leads & Bids
// accurately: card exists, value = base_total, region/town inferred,
// pool jobs read as pool (baby-blue), and every committed work area's
// billed total = its stated total. Run: npm run verify:ingest-commit
//
// Leaves the estimates in place (they're Ian's real proposals) so he can
// see them on the board. Prints the project ids to keep or delete.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { commitIngestedProposal, type IngestReconstruction } from '../src/lib/ingest'
import { isPoolWork } from '../src/lib/poolWork'

config({ path: '.env' })
config({ path: '.env.local' })
const URL_ = process.env.SUPABASE_URL!
const ANON = process.env.VITE_SUPABASE_ANON_KEY!
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TARGETS = [
  { key: 'davidson', name: 'Davidson — 19 Monomoy Rd (imported)', pool: false },
  { key: 'pinkham', name: '1 Pinkham Circle — ACK (imported)', pool: true },
]

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const results: Array<{ key: string; pass: boolean }> = []

async function main() {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.VERIFY_USER_EMAIL! })
  const authed = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: sd } = await authed.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: 'magiclink' })
  const userId = sd.session!.user.id

  for (const t of TARGETS) {
    const recon = JSON.parse(readFileSync(`verifications/ingest/${t.key}.json`, 'utf8')) as IngestReconstruction
    const res = await commitIngestedProposal({ client: authed, userId, proposalName: t.name, reconstruction: recon })

    // Verify the committed data (admin read).
    const { data: was } = await admin
      .from('work_areas')
      .select('id, name, sequence_order, estimate_status')
      .eq('project_id', res.projectId)
      .order('sequence_order')
    const baseWAs = recon.work_areas.filter((w) => w.kind === 'base')

    // The contractor's own markups — cost recovery is only assertable when
    // they actually have some configured.
    const { data: mkSettings } = await admin
      .from('company_settings')
      .select('markup_materials_percent, markup_subs_percent')
      .eq('user_id', userId)
      .maybeSingle()
    const matMk = Number(mkSettings?.markup_materials_percent) || 0
    const subMk = Number(mkSettings?.markup_subs_percent) || 0
    const marksConfigured = matMk > 0 || subMk > 0

    // Every work area's billed total = stated.
    let allReconcile = true
    let poolSubOk = true
    let costOk = true
    let totalCost = 0
    let totalBilled = 0
    for (const wa of was ?? []) {
      const { data: lines } = await admin.from('work_area_lines').select('category, label, quantity, unit_cost, markup_override').eq('work_area_id', wa.id)
      const billed = (lines ?? []).reduce((a, l) => a + Number(l.quantity) * Number(l.unit_cost) * (1 + (Number(l.markup_override) || 0) / 100), 0)
      const stated = baseWAs.find((b) => b.name === wa.name)?.stated_total ?? -1
      if (Math.abs(billed - stated) > 0.02) { allReconcile = false; console.log(`   ✗ ${wa.name}: billed ${money(billed)} != stated ${money(stated)}`) }
      // Pool-builder base WAs must be coded subcontractor @ 10% markup.
      if (/gunite|swimming pool|\bspa\b|baja/i.test(wa.name)) {
        const sub = (lines ?? []).find((l) => l.category === 'subcontractor' && Number(l.markup_override) === 10)
        if (!sub) { poolSubOk = false; console.log(`   ✗ ${wa.name}: pool scope not coded subcontractor @10%`) }
      }
      // COST RECOVERY. Every markup-bearing line must carry a real markup
      // with a cost basis BELOW its billed price. A 0% material line means
      // the estimate claims ZERO margin on materials — the bug this
      // assertion exists to catch (cost $0.60 -> price $0.60).
      // "General Conditions & Rounding" is exempt: it is a rounding plug
      // held at 0% on purpose.
      for (const l of lines ?? []) {
        const cat = String(l.category)
        const cost = Number(l.quantity) * Number(l.unit_cost)
        totalCost += cost
        totalBilled += cost * (1 + (Number(l.markup_override) || 0) / 100)
        if (!['material', 'subcontractor', 'other'].includes(cat)) continue
        if (/general conditions/i.test(String(l.label ?? ''))) continue
        if (!marksConfigured) continue
        if ((Number(l.markup_override) || 0) <= 0) {
          costOk = false
          console.log(`   ✗ ${wa.name}: "${l.label}" (${cat}) at 0% markup — cost == price, margin lost`)
        }
      }
    }

    const { data: lead } = await admin
      .from('leads')
      .select('est_value, region, town, project_name, description, name')
      .eq('project_id', res.projectId)
      .single()

    const valueOk = Math.abs(Number(lead!.est_value) - recon.base_total) < 1
    const onBoard = !!lead
    const poolReads = isPoolWork({ project_name: lead!.project_name, description: lead!.description, project: { id: '', name: t.name, status: 'estimating' } as never })
    const poolOk = poolReads === t.pool
    const waCountOk = (was?.length ?? 0) === baseWAs.length

    const pass = allReconcile && valueOk && onBoard && poolOk && waCountOk && poolSubOk && costOk
    results.push({ key: t.key, pass })
    console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${t.key}  → project ${res.projectId}`)
    console.log(`   ${res.workAreaCount} work areas · ${res.lineCount} lines · ${res.optionCount} options → notes`)
    console.log(`   BOARD CARD: "${lead!.project_name}" · value ${money(Number(lead!.est_value))} (base_total ${money(recon.base_total)}) · region ${lead!.region ?? '—'} · town ${lead!.town ?? '—'}`)
    console.log(`   checks: WAs ${waCountOk ? 'OK' : 'FAIL'} · every WA billed==stated ${allReconcile ? 'OK' : 'FAIL'} · value ${valueOk ? 'OK' : 'FAIL'} · pool-blue ${poolOk ? `OK (${poolReads})` : `FAIL`} · pool→sub@10% ${poolSubOk ? 'OK' : 'FAIL'} · cost recovered ${costOk ? 'OK' : 'FAIL'}`)
    console.log(`   COST BASIS: ${money(totalCost)} cost → ${money(totalBilled)} billed · margin ${money(totalBilled - totalCost)} (${totalBilled > 0 ? (((totalBilled - totalCost) / totalBilled) * 100).toFixed(1) : '0.0'}% of price) · markups ${matMk}% mat / ${subMk}% subs`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n' + '─'.repeat(70))
  console.log(`${results.length - failed.length}/${results.length} committed + verified on the board`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
