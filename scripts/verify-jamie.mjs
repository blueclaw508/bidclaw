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
// J2 UI leg (Playwright, needs the dev server on DEV_URL):
//   8.  founder sees the Jamie Chat button; panel opens; message + photo
//       send; streamed ECHO renders with the image thumbnail
//   9.  upload landed under the caller's own folder AND long edge ≤1568
//       (client-side resize proof — JPEG header parsed server-side)
//   10. message rows persisted with image REFS, not base64
//   11. reload → panel resumes the same thread from jamie_messages
//   12. probe user's session shows NO Jamie Chat button
//   13. mobile (<640px) renders as a full-screen sheet
//
// Artifacts: verifications/jamie/J1-smoke.json + J2-*.png

import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
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

const DEV_URL = process.env.DEV_URL ?? 'http://localhost:5173'
const PROJECT_REF = new URL(URL_).hostname.split('.')[0]

const admin = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
const check = (name, pass, detail = '') => results.push({ name, pass, detail })

/** Long edge of a JPEG from its SOF marker — no image lib needed. */
function jpegDims(buf) {
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

/** Browser context with a real session injected (Path B pattern). */
async function sessionContext(browser, session, viewport) {
  const ctx = await browser.newContext({ viewport: viewport ?? { width: 1280, height: 900 } })
  await ctx.addInitScript(
    ({ k, v }) => window.localStorage.setItem(k, v),
    {
      k: `sb-${PROJECT_REF}-auth-token`,
      v: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }),
    }
  )
  return ctx
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

  // ══ J2 UI LEG (Playwright against the dev server) ══════════════════
  mkdirSync('verifications/jamie', { recursive: true })
  const uiStartTs = new Date().toISOString()
  const browser = await chromium.launch()

  // Test photo: a 2000×1200 render — wider than the 1568 cap, so the
  // client-side resize is actually exercised.
  const scratch = await browser.newPage({ viewport: { width: 2000, height: 1200 } })
  await scratch.setContent(
    '<div style="width:100vw;height:100vh;background:linear-gradient(45deg,#0032A1,#C9A84C)"></div>'
  )
  const testPngPath = 'verifications/jamie/.test-photo-2000px.png'
  await scratch.screenshot({ path: testPngPath })
  await scratch.close()

  // ── 8: founder — button → panel → send text+photo → ECHO renders ──
  const founderCtx = await sessionContext(browser, founderSession)
  const page = await founderCtx.newPage()
  const PROJECT_URL = `${DEV_URL}/app/projects/${proj.id}?tab=work_areas`
  await page.goto(PROJECT_URL, { waitUntil: 'networkidle' })
  const jamieBtn = page.getByRole('button', { name: 'Jamie Chat' })
  await jamieBtn.waitFor({ state: 'visible', timeout: 15000 })
  await jamieBtn.click()
  const panel = page.getByTestId('jamie-chat-panel')
  await panel.waitFor({ state: 'visible', timeout: 10000 })
  await page.setInputFiles('input[aria-label="Attach photos"]', testPngPath)
  const UI_TEXT = 'panel smoke — one photo attached'
  await page.getByRole('textbox', { name: 'Message Jamie' }).fill(UI_TEXT)
  await page.getByRole('button', { name: 'Send message' }).click()
  let echoRendered = true
  try {
    await panel.getByText(`ECHO: ${UI_TEXT}`).waitFor({ timeout: 45000 })
  } catch {
    echoRendered = false
  }
  const thumbCount = await panel.locator('img[alt="Attached photo"]').count()
  await page.screenshot({ path: 'verifications/jamie/J2-panel-echo.png' })
  check('8. UI: button → panel → send w/ photo → streamed ECHO + thumbnail', echoRendered && thumbCount >= 1, `echo=${echoRendered}, thumbnails=${thumbCount} · J2-panel-echo.png`)

  // The run the UI message actually landed in — resolved BY MESSAGE, not
  // by creation timestamp, so the assert holds whether the panel resumed
  // an existing run (correct post-race-fix behavior) or created one.
  const { data: uiMsgRow } = await admin
    .from('jamie_messages')
    .select('jamie_run_id')
    .eq('content->>text', UI_TEXT)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  const uiRunId = uiMsgRow.jamie_run_id

  // ── 9: upload under caller's folder + long edge ≤1568 ─────────────
  const { data: objects } = await admin.storage
    .from('jamie-images')
    .list(`${founderId}/${uiRunId}`)
  let dims = null
  if (objects?.length) {
    const { data: blob } = await admin.storage
      .from('jamie-images')
      .download(`${founderId}/${uiRunId}/${objects[0].name}`)
    dims = jpegDims(Buffer.from(await blob.arrayBuffer()))
  }
  const longEdge = dims ? Math.max(dims.width, dims.height) : null
  check('9. upload in own folder + resized (long edge ≤ 1568)', (objects?.length ?? 0) >= 1 && longEdge !== null && longEdge <= 1568 && longEdge > 1000, `objects=${objects?.length}, dims=${dims ? `${dims.width}×${dims.height}` : 'unparsed'} (source was 2000px)`)

  // ── 10: message rows carry REFS, not base64 ────────────────────────
  const { data: uiMsgs } = await admin
    .from('jamie_messages')
    .select('role, content')
    .eq('jamie_run_id', uiRunId)
    .order('created_at')
  const uiUserMsg = uiMsgs?.find((m) => m.role === 'user' && m.content?.text === UI_TEXT)
  const ref0 = uiUserMsg?.content?.image_refs?.[0] ?? ''
  const uiAsst = uiMsgs?.some((m) => m.role === 'assistant' && m.content?.text?.includes(`ECHO: ${UI_TEXT}`))
  check('10. persisted message has image REF (not base64)', !!uiUserMsg && ref0.startsWith(`${founderId}/`) && ref0.length < 300 && !!uiAsst, `ref=${ref0.slice(0, 60)}… len=${ref0.length}`)

  // ── 11: reload → resume the same thread ───────────────────────────
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Jamie Chat' }).click()
  let resumed = true
  try {
    await page.getByTestId('jamie-chat-panel').getByText(`ECHO: ${UI_TEXT}`).waitFor({ timeout: 15000 })
  } catch {
    resumed = false
  }
  await page.screenshot({ path: 'verifications/jamie/J2-resume.png' })
  check('11. reload → panel resumes thread from jamie_messages', resumed, 'J2-resume.png')
  await founderCtx.close()

  // ── 12: probe user sees NO entry button ────────────────────────────
  const { data: probeProj } = await admin
    .from('projects')
    .insert({ user_id: probeId, name: 'RLS probe project (J2)', status: 'draft' })
    .select('id')
    .single()
  const probeCtx = await sessionContext(browser, probeSession)
  const probePage = await probeCtx.newPage()
  await probePage.goto(`${DEV_URL}/app/projects/${probeProj.id}?tab=work_areas`, { waitUntil: 'networkidle' })
  await probePage.waitForTimeout(2500) // let auth + gate pre-check settle
  const probeBtnCount = await probePage.getByRole('button', { name: 'Jamie Chat' }).count()
  // Two legitimate outcomes, record WHICH barrier fired:
  //  (a) Phase-1 client allowlist (AuthContext isEmailAllowed) bounces the
  //      probe to sign-in — lockout SUPERSEDES button gating entirely;
  //  (b) post-lockdown: probe reaches the app and the gate pre-check hides
  //      the button. Either way: zero Jamie Chat buttons.
  const bouncedToSignIn =
    (await probePage.getByText(/sign-in link|Welcome back/i).count()) > 0
  const inApp = (await probePage.getByText('Work Areas').count()) > 0
  await probePage.screenshot({ path: 'verifications/jamie/J2-probe-no-button.png' })
  check('12. probe session shows NO Jamie Chat button', probeBtnCount === 0 && (bouncedToSignIn || inApp), `buttons=${probeBtnCount}, barrier=${bouncedToSignIn ? 'Phase-1 allowlist bounced to sign-in (supersedes button gate)' : 'in-app, gate hid button'} · J2-probe-no-button.png`)
  await probeCtx.close()

  // ── 13: mobile sheet <640px ────────────────────────────────────────
  const mobileCtx = await sessionContext(browser, founderSession, { width: 375, height: 812 })
  const mobilePage = await mobileCtx.newPage()
  await mobilePage.goto(PROJECT_URL, { waitUntil: 'networkidle' })
  await mobilePage.getByRole('button', { name: 'Jamie Chat' }).click()
  const mobilePanel = mobilePage.getByTestId('jamie-chat-panel')
  await mobilePanel.waitFor({ state: 'visible', timeout: 10000 })
  // Wait for the resumed thread to render (not the loading spinner) AND
  // for the thumbnail's actual image bytes to load (complete +
  // naturalWidth > 0, i.e. the signed URL resolved and painted) — the
  // artifact must prove RENDER, not layout-with-placeholder.
  let mobileResumed = true
  try {
    await mobilePanel.getByText(`ECHO: ${UI_TEXT}`).waitFor({ timeout: 15000 })
  } catch {
    mobileResumed = false
  }
  let mobileThumbLoaded = false
  try {
    await mobilePage.waitForFunction(
      () => {
        const img = document.querySelector(
          '[data-testid="jamie-chat-panel"] img[alt="Attached photo"]'
        )
        return !!img && img.complete && img.naturalWidth > 0
      },
      { timeout: 15000 }
    )
    mobileThumbLoaded = true
  } catch {
    /* recorded below */
  }
  const box = await mobilePanel.boundingBox()
  const fullScreen = box && box.width >= 370 && box.x <= 2
  await mobilePage.screenshot({ path: 'verifications/jamie/J2-mobile.png' })
  check('13. mobile (<640px) full-screen sheet + resumed thread + loaded thumbnail', !!fullScreen && mobileResumed && mobileThumbLoaded, `panel=${box?.width}×${box?.height} at x=${box?.x}, resumed=${mobileResumed}, thumbLoaded=${mobileThumbLoaded} · J2-mobile.png`)
  await mobileCtx.close()
  await browser.close()

  // ── Cleanup ─────────────────────────────────────────────────────────
  // API fixture run + UI-created run(s) on the fixture project + probe
  // project + uploaded photos. Runs cascade messages + invocations.
  if (objects?.length) {
    await admin.storage
      .from('jamie-images')
      .remove(objects.map((o) => `${founderId}/${uiRunId}/${o.name}`))
  }
  await admin.from('jamie_loop_runs').delete().eq('id', run.id)
  await admin
    .from('jamie_loop_runs')
    .delete()
    .eq('project_id', proj.id)
    .gte('created_at', uiStartTs)
  await admin.from('projects').delete().eq('id', probeProj.id)

  // ── Report + artifact ─────────────────────────────────────────────
  const artifact = {
    ran_at: new Date().toISOString(),
    function: 'jamie-chat',
    screenshots: ['J2-panel-echo.png', 'J2-resume.png', 'J2-probe-no-button.png', 'J2-mobile.png'],
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
