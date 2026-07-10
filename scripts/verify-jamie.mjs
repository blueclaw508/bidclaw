// verify-jamie — J1 smoke harness for the jamie-chat Edge Function.
// Run: npm run verify:jamie
//
// Path B pattern (service-role session injection), but API-level: we mint
// real sessions and call the DEPLOYED function over HTTP, then assert
// against the DB. This script is the seed of the canonical Jamie
// regression (extended at J2/J4/J6).
//
// Assertions:
//   1. gate allows founder (200 + SSE)
//   2. ECHO streams back (stub brain round-trip through real Anthropic)
//   3. invocation row lands with real token counts + nonzero cost
//   4. rls-probe user gets 403 JAMIE_NOT_AVAILABLE and NO invocation row
//   5. jamieGate.ts copies (src/lib ↔ function dir) are content-identical
//   6. user + assistant messages persisted on the run
//   7. request_type 'validation' routes to Sonnet — proves the router
//      branch AND that the Sonnet model string is valid on the live API
//      (assertions 1–3 only ever exercise the Opus path)
//
// Artifacts: verifications/jamie/J1-smoke.json

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

config({ path: '.env' })
config({ path: '.env.local' })

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const FOUNDER_EMAIL = process.env.VERIFY_USER_EMAIL
const PROBE_EMAIL = 'jamie-rls-probe@bidclaw.test' // allowlisted in 0021
const FN_URL = `${URL_}/functions/v1/jamie-chat`
const ECHO_TEXT = 'hello Jamie, testing the loop plumbing'

const admin = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
const check = (name, pass, detail = '') => results.push({ name, pass, detail })

async function mintSession(email) {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr) throw new Error(`generateLink(${email}): ${linkErr.message}`)
  const client = createClient(URL_, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  })
  if (error) throw new Error(`verifyOtp(${email}): ${error.message}`)
  return data.session
}

async function callJamieChat(session, body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, json: await res.json(), events: [] }
  }
  // Consume the SSE stream fully; finalize happens server-side before
  // jamie_done, so post-stream DB asserts see final values.
  const events = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (line) {
        try {
          events.push(JSON.parse(line.slice(6)))
        } catch {
          /* keepalive/non-JSON frame */
        }
      }
    }
  }
  return { status: res.status, json: null, events }
}

async function main() {
  // ── Setup: fixture run for the founder ────────────────────────────
  const { data: founderUser } = await admin
    .from('profiles')
    .select('id')
    .eq('email', FOUNDER_EMAIL)
    .single()
  const founderId = founderUser.id
  const { data: proj } = await admin
    .from('projects')
    .select('id')
    .eq('user_id', founderId)
    .limit(1)
    .single()
  const { data: run, error: runErr } = await admin
    .from('jamie_loop_runs')
    .insert({ user_id: founderId, project_id: proj.id, input_summary: 'J1 smoke' })
    .select()
    .single()
  if (runErr) throw new Error(`fixture run: ${runErr.message}`)

  // Ensure the probe user exists (allowlisted fixture from 0021).
  let probeId
  const { data: created, error: probeErr } = await admin.auth.admin.createUser({
    email: PROBE_EMAIL,
    email_confirm: true,
  })
  if (probeErr) {
    const { data: all } = await admin.auth.admin.listUsers()
    probeId = all.users.find((u) => u.email === PROBE_EMAIL)?.id
    if (!probeId) throw new Error(`probe user: ${probeErr.message}`)
  } else {
    probeId = created.user.id
  }

  const [founderSession, probeSession] = await Promise.all([
    mintSession(FOUNDER_EMAIL),
    mintSession(PROBE_EMAIL),
  ])

  // ── 1+2: founder call → ECHO streams back ─────────────────────────
  const t0 = Date.now()
  const founderCall = await callJamieChat(founderSession, {
    jamie_run_id: run.id,
    message: { text: ECHO_TEXT },
  })
  const streamMs = Date.now() - t0
  check('1. gate allows founder (SSE stream, HTTP 200)', founderCall.status === 200 && founderCall.events.length > 0, `status=${founderCall.status}, events=${founderCall.events.length}${founderCall.json ? ', body=' + JSON.stringify(founderCall.json) : ''}`)

  const streamedText = founderCall.events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('')
  const sawDone = founderCall.events.some((e) => e.type === 'jamie_done')
  check('2. ECHO streams back + jamie_done sentinel', streamedText.includes(`ECHO: ${ECHO_TEXT}`) && sawDone, `text=${JSON.stringify(streamedText.slice(0, 120))}, done=${sawDone}, ${streamMs}ms`)

  // ── 3: invocation row with real tokens + nonzero cost ─────────────
  const { data: inv } = await admin
    .from('jamie_invocations')
    .select('*')
    .eq('jamie_run_id', run.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()
  check('3. invocation row: tokens + nonzero cost + finalized', !!inv && inv.input_tokens > 0 && inv.output_tokens > 0 && Number(inv.estimated_cost_usd) > 0 && inv.ended_at !== null && inv.model_used === 'claude-opus-4-8', inv ? `in=${inv.input_tokens} out=${inv.output_tokens} cached=${inv.cached_input_tokens} cost=$${inv.estimated_cost_usd} model=${inv.model_used}` : 'NO ROW')

  // ── 4: probe deny — typed code, zero spend, zero invocation rows ──
  const probeCall = await callJamieChat(probeSession, {
    jamie_run_id: run.id, // even with a real run id, founder gate fires first
    message: { text: 'let me in' },
  })
  const { count: probeInvCount } = await admin
    .from('jamie_invocations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', probeId)
  check('4. probe → 403 JAMIE_NOT_AVAILABLE, no invocation row', probeCall.status === 403 && probeCall.json?.code === 'JAMIE_NOT_AVAILABLE' && probeInvCount === 0, `status=${probeCall.status}, code=${probeCall.json?.code}, probeRows=${probeInvCount}`)

  // ── 5: gate copies identical (no divergent gate implementations) ──
  const srcGate = readFileSync('src/lib/jamieGate.ts', 'utf8')
  const fnGate = readFileSync('supabase/functions/jamie-chat/jamieGate.ts', 'utf8')
  const fnGateBody = fnGate.split('\n').slice(5).join('\n') // strip sync header
  check('5. jamieGate.ts copies content-identical', fnGateBody === srcGate, fnGateBody === srcGate ? '' : 'DIVERGED — sync both files')

  // ── 6: message persistence ────────────────────────────────────────
  const { data: msgs } = await admin
    .from('jamie_messages')
    .select('role, content')
    .eq('jamie_run_id', run.id)
    .order('created_at')
  const userMsg = msgs?.find((m) => m.role === 'user')
  const asstMsg = msgs?.find((m) => m.role === 'assistant')
  check('6. user + assistant messages persisted', !!userMsg && userMsg.content.text === ECHO_TEXT && !!asstMsg && asstMsg.content.text.includes('ECHO:'), `messages=${msgs?.length ?? 0}`)

  // ── 7: 'validation' request_type routes to Sonnet ─────────────────
  const SONNET_TEXT = 'router check via the validation branch'
  const sonnetCall = await callJamieChat(founderSession, {
    jamie_run_id: run.id,
    message: { text: SONNET_TEXT },
    request_type: 'validation',
  })
  const sonnetText = sonnetCall.events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('')
  const sonnetErr = sonnetCall.events.find((e) => e.type === 'jamie_error')
  const { data: sonnetInv } = await admin
    .from('jamie_invocations')
    .select('model_used, input_tokens, output_tokens, estimated_cost_usd, ended_at')
    .eq('jamie_run_id', run.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()
  check('7. validation request_type → Sonnet streams + metered', sonnetCall.status === 200 && sonnetText.includes(`ECHO: ${SONNET_TEXT}`) && !sonnetErr && sonnetInv?.model_used?.includes('sonnet') && sonnetInv.input_tokens > 0 && Number(sonnetInv.estimated_cost_usd) > 0 && sonnetInv.ended_at !== null, sonnetErr ? `jamie_error=${sonnetErr.error}` : `model=${sonnetInv?.model_used} in=${sonnetInv?.input_tokens} out=${sonnetInv?.output_tokens} cost=$${sonnetInv?.estimated_cost_usd}`)

  // ── Cleanup (fixture run cascades messages + invocations) ─────────
  await admin.from('jamie_loop_runs').delete().eq('id', run.id)

  // ── Report + artifact ─────────────────────────────────────────────
  mkdirSync('verifications/jamie', { recursive: true })
  const artifact = {
    ran_at: new Date().toISOString(),
    function: 'jamie-chat',
    results,
    invocation_sample: inv
      ? {
          model: inv.model_used,
          input_tokens: inv.input_tokens,
          output_tokens: inv.output_tokens,
          cached_input_tokens: inv.cached_input_tokens,
          estimated_cost_usd: inv.estimated_cost_usd,
        }
      : null,
    stream_ms: streamMs,
  }
  writeFileSync('verifications/jamie/J1-smoke.json', JSON.stringify(artifact, null, 2))

  const failed = results.filter((r) => !r.pass)
  console.log('\nVERIFY-JAMIE (J1 smoke)')
  console.log('─'.repeat(72))
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  · ${r.detail}` : ''}`)
  console.log('─'.repeat(72))
  console.log(`${results.length - failed.length}/${results.length} passed · artifact: verifications/jamie/J1-smoke.json`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(1)
})
