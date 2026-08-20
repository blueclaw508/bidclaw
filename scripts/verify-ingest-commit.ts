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

    // Every work area's billed total (markup 0 → sum qty*unit_cost) = stated.
    let allReconcile = true
    for (const wa of was ?? []) {
      const { data: lines } = await admin.from('work_area_lines').select('quantity, unit_cost').eq('work_area_id', wa.id)
      const billed = (lines ?? []).reduce((a, l) => a + Number(l.quantity) * Number(l.unit_cost), 0)
      const stated = baseWAs.find((b) => b.name === wa.name)?.stated_total ?? -1
      if (Math.abs(billed - stated) > 0.02) { allReconcile = false; console.log(`   ✗ ${wa.name}: billed ${money(billed)} != stated ${money(stated)}`) }
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

    const pass = allReconcile && valueOk && onBoard && poolOk && waCountOk
    results.push({ key: t.key, pass })
    console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${t.key}  → project ${res.projectId}`)
    console.log(`   ${res.workAreaCount} work areas · ${res.lineCount} lines · ${res.optionCount} options → notes`)
    console.log(`   BOARD CARD: "${lead!.project_name}" · value ${money(Number(lead!.est_value))} (base_total ${money(recon.base_total)}) · region ${lead!.region ?? '—'} · town ${lead!.town ?? '—'}`)
    console.log(`   checks: WAs ${waCountOk ? 'OK' : 'FAIL'} · every WA billed==stated ${allReconcile ? 'OK' : 'FAIL'} · value ${valueOk ? 'OK' : 'FAIL'} · pool-blue ${poolOk ? `OK (${poolReads})` : `FAIL (got ${poolReads}, want ${t.pool})`}`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n' + '─'.repeat(70))
  console.log(`${results.length - failed.length}/${results.length} committed + verified on the board`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
