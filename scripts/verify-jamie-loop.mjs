// verify-jamie-loop — J3 harness for WHOLE-PROJECT MODE.
// Run: npm run verify:jamie-loop
//
// Walks the entire loop end to end against the DEPLOYED jamie-chat and the
// live database, then cleans up after itself:
//
//   1. chat turn returns real prose (the ECHO stub is gone)
//   2. propose_work_areas stages jamie_proposed_work_areas + run moves to
//      awaiting_wa_approval
//   3. Gate 1 commit creates real work_areas and stamps
//      inserted_work_area_id; a REJECTED proposal stays rejected with a
//      null inserted id (J0 audit-trail rule)
//   4. propose_lines stages jamie_proposed_lines under the approved WAs and
//      the run moves to awaiting_line_approval
//   5. staged lines look like a KYN takeoff (labor hours + a General
//      Conditions line) and echo only ids we handed Jamie
//   6. Gate 2 commit writes work_area_lines and closes the run as committed
//   7. invocation rows metered on claude-opus-5 with nonzero cost
//
// Gate commits are replayed here with the SAME shape as jamieLoop.ts (this
// is a node harness — it cannot import the browser data layer), so a
// divergence between the two is a real risk. Assertion 3/6 check the
// OBSERVABLE result (real rows + stamps), which is what jamieLoop.ts
// promises; if you change the gate semantics, change both.
//
// Artifacts: verifications/jamie/J3-loop.json

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'

config({ path: '.env' })
config({ path: '.env.local' })

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const FOUNDER_EMAIL = process.env.VERIFY_USER_EMAIL
const FN_URL = `${URL_}/functions/v1/jamie-chat`

if (!URL_ || !SERVICE_KEY || !ANON_KEY || !FOUNDER_EMAIL) {
  console.error(
    'Missing env. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, VERIFY_USER_EMAIL in .env / .env.local'
  )
  process.exit(1)
}

const admin = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  · ${detail}` : ''}`)
}

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
          /* keepalive */
        }
      }
    }
  }
  return { status: res.status, json: null, events }
}

const textOf = (events) =>
  events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('')

// A real job, described the way Ian would describe one.
const SCOPE = `New build on Osterville. Two things out back.
Rear terrace: 620 SF of dry-laid bluestone, thermal, over compacted
processed base. Roughly 96 LF of open edge that needs edge restraint.
Front walk: 140 SF of the same bluestone, plus 4 granite steps up to the
entry. Machine access is fine off the driveway. We haul off the spoils.`

async function main() {
  const started = Date.now()
  const session = await mintSession(FOUNDER_EMAIL)
  const founderId = session.user.id

  // ── Fixture project (cleaned up at the end) ───────────────────────
  const { data: customer, error: custErr } = await admin
    .from('customers')
    .insert({ user_id: founderId, name: 'J3 Harness Customer' })
    .select('id')
    .single()
  if (custErr) throw new Error(`fixture customer: ${custErr.message}`)

  const { data: project, error: projErr } = await admin
    .from('projects')
    .insert({
      user_id: founderId,
      customer_id: customer.id,
      name: 'J3 Harness — Osterville',
      site_address_line1: '12 Harness Way',
      site_address_city: 'Osterville',
      site_address_state: 'MA',
    })
    .select('id')
    .single()
  if (projErr) throw new Error(`fixture project: ${projErr.message}`)
  const projectId = project.id

  const { data: run, error: runErr } = await admin
    .from('jamie_loop_runs')
    .insert({ user_id: founderId, project_id: projectId })
    .select('id')
    .single()
  if (runErr) throw new Error(`fixture run: ${runErr.message}`)
  const runId = run.id

  const cleanup = async () => {
    // jamie_* and work_areas cascade from run / project.
    await admin.from('jamie_loop_runs').delete().eq('id', runId)
    await admin.from('projects').delete().eq('id', projectId)
    await admin.from('customers').delete().eq('id', customer.id)
  }

  try {
    // ── 1: chat turn returns real prose ────────────────────────────
    const chat = await callJamieChat(session, {
      jamie_run_id: runId,
      message: { text: SCOPE },
      action: 'chat',
    })
    const chatText = textOf(chat.events)
    check(
      '1. chat turn returns real prose (ECHO stub gone)',
      chat.status === 200 && chatText.length > 40 && !chatText.includes('ECHO:'),
      `status=${chat.status}, chars=${chatText.length}, head=${JSON.stringify(chatText.slice(0, 90))}`
    )

    // ── 2: Pass 1 stages work areas + moves the run ────────────────
    const pass1 = await callJamieChat(session, {
      jamie_run_id: runId,
      message: { text: '' },
      action: 'propose_work_areas',
    })
    const pass1Err = pass1.events.find((e) => e.type === 'jamie_error')
    const staged1 = pass1.events.find((e) => e.type === 'jamie_staged')
    const { data: pwas } = await admin
      .from('jamie_proposed_work_areas')
      .select('*')
      .eq('jamie_run_id', runId)
      .order('sort_order')
    const { data: runAfter1 } = await admin
      .from('jamie_loop_runs')
      .select('status')
      .eq('id', runId)
      .single()
    check(
      '2. propose_work_areas stages WAs + run → awaiting_wa_approval',
      !pass1Err &&
        (pwas?.length ?? 0) >= 1 &&
        runAfter1?.status === 'awaiting_wa_approval' &&
        staged1?.gate === 'work_areas',
      pass1Err
        ? `jamie_error=${pass1Err.error}`
        : `staged=${pwas?.length}, status=${runAfter1?.status}, names=${(pwas ?? []).map((p) => p.proposed_name).join(' | ')}`
    )
    if (!pwas || pwas.length === 0) throw new Error('no staged work areas — cannot continue')

    // ── 3: Gate 1 — approve all but the last, reject the last ──────
    // Mirrors commitWorkAreaGate: append after existing, stamp the id,
    // mark rejections and RETAIN them.
    const toApprove = pwas.slice(0, Math.max(1, pwas.length - 1))
    const toReject = pwas.slice(Math.max(1, pwas.length - 1))
    let order = 0
    const createdIds = []
    for (const p of toApprove) {
      const { data: wa, error: waErr } = await admin
        .from('work_areas')
        .insert({
          project_id: projectId,
          name: p.proposed_name,
          description: p.proposed_description,
          sequence_order: order++,
        })
        .select('id')
        .single()
      if (waErr) throw new Error(`gate1 work_area: ${waErr.message}`)
      createdIds.push(wa.id)
      await admin
        .from('jamie_proposed_work_areas')
        .update({ status: 'approved', inserted_work_area_id: wa.id })
        .eq('id', p.id)
    }
    if (toReject.length > 0) {
      await admin
        .from('jamie_proposed_work_areas')
        .update({ status: 'rejected' })
        .in(
          'id',
          toReject.map((p) => p.id)
        )
    }
    await admin.from('jamie_loop_runs').update({ status: 'in_progress' }).eq('id', runId)

    const { data: realWas } = await admin
      .from('work_areas')
      .select('id, name')
      .eq('project_id', projectId)
    const { data: stampCheck } = await admin
      .from('jamie_proposed_work_areas')
      .select('status, inserted_work_area_id')
      .eq('jamie_run_id', runId)
    const approvedStamped = (stampCheck ?? []).filter(
      (s) => s.status === 'approved' && s.inserted_work_area_id
    ).length
    const rejectedRetained = (stampCheck ?? []).filter(
      (s) => s.status === 'rejected' && s.inserted_work_area_id === null
    ).length
    check(
      '3. Gate 1 → real work_areas + stamps; rejected retained, unstamped',
      (realWas?.length ?? 0) === toApprove.length &&
        approvedStamped === toApprove.length &&
        rejectedRetained === toReject.length,
      `real=${realWas?.length}, approvedStamped=${approvedStamped}, rejectedRetained=${rejectedRetained}/${toReject.length}`
    )

    // ── 4: Pass 2 stages lines under the approved WAs ──────────────
    const pass2 = await callJamieChat(session, {
      jamie_run_id: runId,
      message: { text: '' },
      action: 'propose_lines',
    })
    const pass2Err = pass2.events.find((e) => e.type === 'jamie_error')
    const staged2 = pass2.events.find((e) => e.type === 'jamie_staged')
    const approvedPwaIds = toApprove.map((p) => p.id)
    const { data: lines } = await admin
      .from('jamie_proposed_lines')
      .select('*')
      .in('jamie_proposed_work_area_id', approvedPwaIds)
      .order('sort_order')
    const { data: runAfter2 } = await admin
      .from('jamie_loop_runs')
      .select('status')
      .eq('id', runId)
      .single()
    check(
      '4. propose_lines stages lines + run → awaiting_line_approval',
      !pass2Err &&
        (lines?.length ?? 0) >= 3 &&
        runAfter2?.status === 'awaiting_line_approval' &&
        staged2?.gate === 'lines',
      pass2Err
        ? `jamie_error=${pass2Err.error}`
        : `lines=${lines?.length}, status=${runAfter2?.status}`
    )
    if (!lines || lines.length === 0) throw new Error('no staged lines — cannot continue')

    // ── 5: the takeoff looks like KYN, and only echoes ids we gave ──
    const { data: strayLines } = await admin
      .from('jamie_proposed_lines')
      .select('id')
      .not('jamie_proposed_work_area_id', 'in', `(${approvedPwaIds.join(',')})`)
      .in(
        'jamie_proposed_work_area_id',
        (pwas ?? []).map((p) => p.id)
      )
    const hasLabor = lines.some((l) => l.category === 'labor' && Number(l.quantity) > 0)
    const hasGC = lines.some((l) => /general conditions/i.test(l.label))
    const categories = [...new Set(lines.map((l) => l.category))]
    check(
      '5. takeoff is KYN-shaped (labor hours + General Conditions), no stray ids',
      hasLabor && hasGC && (strayLines?.length ?? 0) === 0,
      `labor=${hasLabor}, generalConditions=${hasGC}, categories=${categories.join('/')}, strayOnRejectedWA=${strayLines?.length ?? 0}`
    )

    // ── 6: Gate 2 — commit every staged line ───────────────────────
    const pwaToWa = Object.fromEntries(
      (stampCheck ?? [])
        .filter((s) => s.inserted_work_area_id)
        .map((s, i) => [approvedPwaIds[i], s.inserted_work_area_id])
    )
    // Re-read with the parent id so the mapping is exact, not positional.
    const { data: linesWithParent } = await admin
      .from('jamie_proposed_lines')
      .select('id, jamie_proposed_work_area_id, category, label, unit, quantity, unit_cost, sort_order')
      .in('jamie_proposed_work_area_id', approvedPwaIds)
    const { data: parentMap } = await admin
      .from('jamie_proposed_work_areas')
      .select('id, inserted_work_area_id')
      .in('id', approvedPwaIds)
    const parentById = Object.fromEntries(
      (parentMap ?? []).map((p) => [p.id, p.inserted_work_area_id])
    )
    void pwaToWa
    let written = 0
    for (const l of linesWithParent ?? []) {
      const waId = parentById[l.jamie_proposed_work_area_id]
      if (!waId) continue
      const { data: row, error: lineErr } = await admin
        .from('work_area_lines')
        .insert({
          work_area_id: waId,
          category: l.category,
          label: l.label,
          unit: l.unit ?? '',
          quantity: l.quantity ?? 0,
          unit_cost: l.unit_cost ?? 0,
          price_override: null,
          sort_order: l.sort_order ?? 0,
        })
        .select('id')
        .single()
      if (lineErr) throw new Error(`gate2 line "${l.label}": ${lineErr.message}`)
      written++
      await admin
        .from('jamie_proposed_lines')
        .update({ status: 'approved', inserted_work_area_line_id: row.id })
        .eq('id', l.id)
    }
    await admin.from('jamie_loop_runs').update({ status: 'committed' }).eq('id', runId)

    const { count: realLineCount } = await admin
      .from('work_area_lines')
      .select('id', { count: 'exact', head: true })
      .in('work_area_id', createdIds)
    const { data: runFinal } = await admin
      .from('jamie_loop_runs')
      .select('status')
      .eq('id', runId)
      .single()
    check(
      '6. Gate 2 → work_area_lines written, run committed',
      written > 0 && realLineCount === written && runFinal?.status === 'committed',
      `written=${written}, realLines=${realLineCount}, status=${runFinal?.status}`
    )

    // ── 7: metering on the new model ───────────────────────────────
    const { data: invs } = await admin
      .from('jamie_invocations')
      .select('model_used, input_tokens, output_tokens, estimated_cost_usd, ended_at')
      .eq('jamie_run_id', runId)
      .order('started_at')
    const allFinal = (invs ?? []).every(
      (i) => i.ended_at !== null && i.input_tokens > 0 && i.output_tokens > 0
    )
    const onOpus5 = (invs ?? []).every((i) => i.model_used === 'claude-opus-5')
    const totalCost = (invs ?? []).reduce((a, i) => a + Number(i.estimated_cost_usd ?? 0), 0)
    check(
      '7. every invocation metered on claude-opus-5 with real tokens + cost',
      (invs?.length ?? 0) === 3 && allFinal && onOpus5 && totalCost > 0,
      `rows=${invs?.length}, models=${[...new Set((invs ?? []).map((i) => i.model_used))].join('/')}, total=$${totalCost.toFixed(4)}`
    )

    mkdirSync('verifications/jamie', { recursive: true })
    writeFileSync(
      'verifications/jamie/J3-loop.json',
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          failed,
          results,
          proposedWorkAreas: (pwas ?? []).map((p) => p.proposed_name),
          lineCount: lines.length,
          invocations: invs,
        },
        null,
        2
      )
    )
  } finally {
    await cleanup()
  }

  console.log(
    `\n${results.length - failed}/${results.length} passed · ${((Date.now() - started) / 1000).toFixed(1)}s · fixtures cleaned up`
  )
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('\nHARNESS ERROR:', err.message)
  process.exit(1)
})
