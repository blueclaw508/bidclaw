// J0 gate + schema test harness. Run: npm run test:jamie-gate
//
// Part A — pure gate matrix: evaluateFounderModeGate/evaluateJamieGate
//   against the LIVE seeded subscription_tier_limits rows (not hardcoded
//   copies), covering every deny code + the founder allow.
// Part B — DB fixtures via service role: quota_month generated column,
//   RLS second-user probe (dummy user must see NONE of the founder's
//   jamie rows), tier-limits client-write denial. Fixtures are cleaned
//   up at the end (run delete cascades; dummy user deleted).

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import {
  evaluateFounderModeGate,
  evaluateJamieGate,
  isLegalRunTransition,
  FOUNDER_USER_ID,
  type JamieUsage,
  type TierLimits,
} from '../src/lib/jamieGate'

config({ path: '.env' })
config({ path: '.env.local' })

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!

const admin = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail })
}

const ZERO: JamieUsage = {
  jamieEstimatesThisMonth: 0,
  invocationsThisMonth: 0,
  invocationsLastHour: 0,
  imagesThisSession: 0,
  turnsThisSession: 0,
}

async function main() {
  // ── Part A: pure gate matrix over LIVE tier rows ──────────────────
  const { data: tierRows, error: tierErr } = await admin
    .from('subscription_tier_limits')
    .select('*')
  if (tierErr) throw new Error(`tier read failed: ${tierErr.message}`)
  const tiers = Object.fromEntries(
    (tierRows as TierLimits[]).map((t) => [t.tier, t])
  )
  check('seed: 5 tiers present', Object.keys(tiers).length === 5, Object.keys(tiers).sort().join(','))

  const founder = tiers['founder']
  const free = tiers['free']
  const proAi = tiers['pro_ai']

  let r = evaluateFounderModeGate(FOUNDER_USER_ID, founder, ZERO)
  check('founder allow', r.allowed === true, JSON.stringify(r))

  r = evaluateFounderModeGate('00000000-0000-0000-0000-000000000001', proAi, ZERO)
  check('non-founder deny (founder mode)', !r.allowed && r.code === 'JAMIE_NOT_AVAILABLE', JSON.stringify(r))

  r = evaluateJamieGate(free, ZERO)
  check('free tier → UPGRADE_REQUIRED', !r.allowed && r.code === 'UPGRADE_REQUIRED', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { ...ZERO, jamieEstimatesThisMonth: 30 })
  check('pro_ai 30/30 estimates → QUOTA_REACHED', !r.allowed && r.code === 'QUOTA_REACHED', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { ...ZERO, invocationsThisMonth: 100 })
  check('pro_ai 100 total invocations → QUOTA_REACHED (rejection-loop ceiling)', !r.allowed && r.code === 'QUOTA_REACHED', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { ...ZERO, invocationsLastHour: 10 })
  check('pro_ai 10/hr → RATE_LIMIT', !r.allowed && r.code === 'RATE_LIMIT', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { ...ZERO, imagesThisSession: 10 })
  check('pro_ai 10 images/session → IMAGE_LIMIT', !r.allowed && r.code === 'IMAGE_LIMIT', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { ...ZERO, turnsThisSession: 8 })
  check('pro_ai 8 turns/session → TURN_LIMIT', !r.allowed && r.code === 'TURN_LIMIT', JSON.stringify(r))

  r = evaluateJamieGate(proAi, { jamieEstimatesThisMonth: 29, invocationsThisMonth: 99, invocationsLastHour: 9, imagesThisSession: 9, turnsThisSession: 7 })
  check('pro_ai one-under-every-limit → allowed', r.allowed === true, JSON.stringify(r))

  r = evaluateJamieGate(founder, { jamieEstimatesThisMonth: 9999, invocationsThisMonth: 9999, invocationsLastHour: 9999, imagesThisSession: 9999, turnsThisSession: 9999 })
  check('founder all-NULL limits ignore huge usage', r.allowed === true, JSON.stringify(r))

  check('transition: in_progress → awaiting_wa_approval legal', isLegalRunTransition('in_progress', 'awaiting_wa_approval'))
  check('transition: awaiting_line_approval → committed legal', isLegalRunTransition('awaiting_line_approval', 'committed'))
  check('transition: committed → in_progress ILLEGAL', !isLegalRunTransition('committed', 'in_progress'))
  check('transition: in_progress → committed ILLEGAL (must pass gates)', !isLegalRunTransition('in_progress', 'committed'))
  check('transition: error → in_progress legal (retry)', isLegalRunTransition('error', 'in_progress'))

  // ── Part B: DB fixtures ───────────────────────────────────────────
  // Founder fixture run + invocation → quota_month generated column.
  const { data: proj } = await admin
    .from('projects')
    .select('id')
    .eq('user_id', FOUNDER_USER_ID)
    .limit(1)
    .single()
  const { data: run, error: runErr } = await admin
    .from('jamie_loop_runs')
    .insert({ user_id: FOUNDER_USER_ID, project_id: proj!.id, input_summary: 'J0 fixture' })
    .select()
    .single()
  if (runErr) throw new Error(`fixture run insert failed: ${runErr.message}`)

  const { data: inv, error: invErr } = await admin
    .from('jamie_invocations')
    .insert({ user_id: FOUNDER_USER_ID, jamie_run_id: run.id, model_used: 'fixture', input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.0123 })
    .select('id, quota_month, started_at')
    .single()
  if (invErr) throw new Error(`fixture invocation insert failed: ${invErr.message}`)
  const expectedMonth = new Date().toISOString().slice(0, 8) + '01'
  check('quota_month generated column populates', inv.quota_month === expectedMonth, `got ${inv.quota_month}, expected ${expectedMonth}`)

  const { data: pwa, error: pwaErr } = await admin
    .from('jamie_proposed_work_areas')
    .insert({ jamie_run_id: run.id, proposed_name: 'Fixture WA' })
    .select()
    .single()
  if (pwaErr) throw new Error(`fixture PWA insert failed: ${pwaErr.message}`)
  const { error: plErr } = await admin
    .from('jamie_proposed_lines')
    .insert({ jamie_proposed_work_area_id: pwa.id, category: 'labor', label: 'Fixture line', needs_pricing: true })
  check('staged WA + line insert (category=labor, needs_pricing)', !plErr, plErr?.message ?? '')

  // RLS probe: dummy user must see NONE of the founder's jamie rows.
  // Fixture address allowlisted in 0021 — .test TLD receives no mail, so
  // only service-role harnesses can ever sign it in.
  const dummyEmail = 'jamie-rls-probe@bidclaw.test'
  let dummyId: string
  const { data: dummy, error: dummyErr } = await admin.auth.admin.createUser({
    email: dummyEmail,
    email_confirm: true,
  })
  if (dummyErr) {
    // Leftover from an interrupted prior run — reuse it.
    const { data: existing } = await admin.auth.admin.listUsers()
    const found = existing?.users.find((u) => u.email === dummyEmail)
    if (!found) throw new Error(`dummy user create failed: ${dummyErr.message}`)
    dummyId = found.id
  } else {
    dummyId = dummy.user.id
  }
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: dummyEmail })
  const probe = createClient(URL_, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: otpErr } = await probe.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: 'magiclink' })
  if (otpErr) throw new Error(`dummy sign-in failed: ${otpErr.message}`)

  const [runsSeen, invSeen, pwaSeen, tiersSeen] = await Promise.all([
    probe.from('jamie_loop_runs').select('id'),
    probe.from('jamie_invocations').select('id'),
    probe.from('jamie_proposed_work_areas').select('id'),
    probe.from('subscription_tier_limits').select('tier'),
  ])
  check('RLS: dummy sees 0 founder runs', (runsSeen.data ?? []).length === 0, `saw ${(runsSeen.data ?? []).length}`)
  check('RLS: dummy sees 0 founder invocations', (invSeen.data ?? []).length === 0, `saw ${(invSeen.data ?? []).length}`)
  check('RLS: dummy sees 0 founder staged WAs', (pwaSeen.data ?? []).length === 0, `saw ${(pwaSeen.data ?? []).length}`)
  check('RLS: tier limits readable by any signed-in user', (tiersSeen.data ?? []).length === 5, `saw ${(tiersSeen.data ?? []).length}`)

  const { error: tierWriteErr } = await probe
    .from('subscription_tier_limits')
    .update({ monthly_jamie_estimates: 99999 })
    .eq('tier', 'free')
    .select()
  const { data: freeAfter } = await admin
    .from('subscription_tier_limits')
    .select('monthly_jamie_estimates')
    .eq('tier', 'free')
    .single()
  check('RLS: tier limits NOT writable by client', tierWriteErr !== null || freeAfter!.monthly_jamie_estimates === 0, `err=${tierWriteErr?.message ?? 'none'}, free.jamie=${freeAfter!.monthly_jamie_estimates}`)

  // Dummy also can't insert a run pointing at the founder's project.
  const { error: forgeErr } = await probe
    .from('jamie_loop_runs')
    .insert({ user_id: FOUNDER_USER_ID, jamie_run_id: undefined, project_id: proj!.id })
  check('RLS: dummy cannot forge a founder-owned run', forgeErr !== null, forgeErr?.message ?? 'INSERT SUCCEEDED (bad)')

  // ── Cleanup ───────────────────────────────────────────────────────
  await admin.from('jamie_loop_runs').delete().eq('id', run.id) // cascades
  await admin.auth.admin.deleteUser(dummyId)
  const { data: leftover } = await admin.from('jamie_invocations').select('id').eq('jamie_run_id', run.id)
  check('cleanup: cascade removed fixture invocations', (leftover ?? []).length === 0)

  // ── Report ────────────────────────────────────────────────────────
  const failed = results.filter((x) => !x.pass)
  console.log('\nJ0 GATE TEST RESULTS')
  console.log('─'.repeat(72))
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : `  ← ${x.detail}`}`)
  }
  console.log('─'.repeat(72))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(1)
})
