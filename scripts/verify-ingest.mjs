// verify-ingest — RI1 harness for jamie-ingest (reverse ingestion).
// Runs real BCA proposals through the DEPLOYED function and checks:
//   Layer 1  work areas + STATED totals extracted (Valente checked exact)
//   Layer 2  every work area's line_items reconcile to its stated_total
// Writes the full reconstruction to verifications/ingest/<key>.json so the
// decomposition quality (GC balancer size, confidence) is inspectable.
//
// Usage: node scripts/verify-ingest.mjs [key1,key2,...]   (default: valente)

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

config({ path: '.env' })
config({ path: '.env.local' })

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const FN = `${URL_}/functions/v1/jamie-ingest`
const SCRATCH =
  'C:/Users/Ian/AppData/Local/Temp/claude/C--Users-Ian--claude/e24c17ce-c584-4d21-aa17-efb8e36d3808/scratchpad'

const PROPOSALS = {
  valente: { file: `${SCRATCH}/valente-proposal.txt`, expectBaseTotal: 100133, expectMinBaseWAs: 10 },
  pinkham: { file: `${SCRATCH}/prop-pinkham.txt` },
  goff: { file: `${SCRATCH}/prop-goff.txt` },
  davidson: { file: `${SCRATCH}/prop-davidson.txt` },
  weedweeder: { file: `${SCRATCH}/prop-weedweeder.txt` },
}

const keys = (process.argv[2] || 'valente').split(',').map((k) => k.trim())
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function founderSession() {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.VERIFY_USER_EMAIL })
  const anon = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  return data.session
}

async function ingest(session, text) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal_text: text }),
  })
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { error: await res.json(), status: res.status }
  }
  let full = ''
  let err = null
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '))
      buf = buf.slice(i + 2)
      if (!line) continue
      let ev
      try { ev = JSON.parse(line.slice(6)) } catch { continue }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') full += ev.delta.text
      else if (ev.type === 'jamie_error') err = ev.error
    }
  }
  if (err) return { error: { error: err } }
  return { text: full }
}

const results = []
const money = (n) => `$${Math.round(Number(n)).toLocaleString()}`

async function main() {
  const session = await founderSession()
  mkdirSync('verifications/ingest', { recursive: true })

  for (const key of keys) {
    const spec = PROPOSALS[key]
    if (!spec) { console.log(`unknown proposal: ${key}`); continue }
    const text = readFileSync(spec.file, 'utf8')
    const t0 = Date.now()
    const out = await ingest(session, text)
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    if (out.error) { console.log(`FAIL  ${key} — ${JSON.stringify(out.error)}`); results.push({ key, pass: false }); continue }

    let parsed
    try { parsed = JSON.parse(out.text) } catch (e) {
      console.log(`FAIL  ${key} — JSON parse (${e.message}); raw head: ${out.text.slice(0, 160)}`)
      results.push({ key, pass: false }); continue
    }
    writeFileSync(`verifications/ingest/${key}.json`, JSON.stringify(parsed, null, 2))

    const was = parsed.work_areas || []
    const base = was.filter((w) => w.kind === 'base')
    // Layer 2: does every WA's line_items sum to its stated_total?
    const recon = was.map((w) => {
      const sum = (w.line_items || []).reduce((a, l) => a + Number(l.qty) * Number(l.unit_cost), 0)
      return { name: w.name, ok: Math.abs(sum - Number(w.stated_total)) < 0.02, sum, stated: Number(w.stated_total), gc: Number(w.general_conditions_amount), conf: w.confidence, kind: w.kind, lines: (w.line_items || []).length }
    })
    const reconAllOk = recon.every((r) => r.ok)
    const layer1Ok = spec.expectBaseTotal
      ? Math.abs(Number(parsed.base_total) - spec.expectBaseTotal) < 1 && base.length >= spec.expectMinBaseWAs
      : was.length > 0
    const pass = reconAllOk && layer1Ok && was.length > 0
    results.push({ key, pass, secs, was: was.length, base: base.length, baseTotal: parsed.base_total, reconAllOk, layer1Ok })

    console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${key}  (${secs}s)  · ${was.length} work areas (${base.length} base) · base_total ${money(parsed.base_total)}${spec.expectBaseTotal ? ` (expect ${money(spec.expectBaseTotal)})` : ''}`)
    console.log(`   customer=${parsed.customer_name} · site=${parsed.site_address}`)
    console.log(`   Layer1 ${layer1Ok ? 'OK' : 'FAIL'} · Layer2 reconcile ${reconAllOk ? 'OK (all WAs sum to total)' : 'FAIL'}`)
    for (const r of recon) {
      console.log(`     ${r.ok ? '✓' : '✗'} ${r.kind.padEnd(18)} ${r.name.slice(0, 40).padEnd(40)} stated ${money(r.stated).padStart(9)} · lines ${String(r.lines).padStart(2)} · GC ${money(r.gc).padStart(9)} · ${r.conf}`)
    }
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n' + '─'.repeat(72))
  console.log(`${results.length - failed.length}/${results.length} proposals passed · artifacts in verifications/ingest/`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
