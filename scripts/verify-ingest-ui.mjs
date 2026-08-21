// verify-ingest-ui — RI2 end-to-end: drive the Import Proposal flow in
// the real UI (local dev server) → deployed jamie-ingest → review →
// commit → estimate on the board. Uses Davidson (fast, ~50s).
// Needs the dev server on DEV_URL (default :5173).

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, readFileSync } from 'fs'

config({ path: '.env' })
config({ path: '.env.local' })
const URL_ = process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const DEV = process.env.DEV_URL ?? 'http://localhost:5173'
const REF = new URL(URL_).hostname.split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const results = []
const check = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  · ' + d : ''}`) }

async function main() {
  const davidson = readFileSync('C:/Users/Ian/AppData/Local/Temp/claude/C--Users-Ian--claude/e24c17ce-c584-4d21-aa17-efb8e36d3808/scratchpad/prop-davidson.txt', 'utf8')

  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.VERIFY_USER_EMAIL })
  const anon = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: sd } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  const s = sd.session

  mkdirSync('verifications/ingest', { recursive: true })
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(({ k, v }) => window.localStorage.setItem(k, v), { k: `sb-${REF}-auth-token`, v: JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: s.token_type, user: s.user }) })
  const page = await ctx.newPage()

  await page.goto(`${DEV}/app/projects`, { waitUntil: 'networkidle' })
  // Founder-gated button appears after the gate pre-check resolves.
  const importBtn = page.getByRole('button', { name: 'Import proposal' })
  await importBtn.waitFor({ state: 'visible', timeout: 15000 })
  check('1. founder sees the Import proposal button', true)
  await importBtn.click()

  await page.getByPlaceholder(/Paste the full proposal text/i).fill(davidson)
  await page.getByRole('button', { name: 'Rebuild with Jamie' }).click()
  check('2. ingestion started', await page.getByText(/Reading your proposal|work area|Finding the work areas/i).first().isVisible().catch(() => false))

  // Review step: wait for the reconstructed summary (up to ~2 min).
  let reviewOk = true
  try {
    await page.getByRole('button', { name: 'Create estimate' }).waitFor({ timeout: 150000 })
  } catch { reviewOk = false }
  const custShown = await page.getByText('Scott Davidson', { exact: false }).count()
  const valShown = await page.getByText('$32,261', { exact: false }).count()
  await page.screenshot({ path: 'verifications/ingest/ui-review.png' })
  check('3. review shows customer + base total + work areas', reviewOk && custShown >= 1 && valShown >= 1, `review=${reviewOk} customer=${custShown} value=${valShown}`)

  await page.getByRole('button', { name: 'Create estimate' }).click()
  // Navigates to the new estimate's Work Areas tab.
  await page.waitForURL(/\/app\/projects\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const url = page.url()
  const projId = url.match(/projects\/([0-9a-f-]{36})/)?.[1]
  const waRendered = await page.getByText(/Install Caps on Front Porch Wall|Wet Lain Granite Patio/i).count()
  await page.screenshot({ path: 'verifications/ingest/ui-estimate.png' })
  check('4. committed → navigated to the new estimate with work areas', !!projId && waRendered >= 1, `proj=${projId} waRendered=${waRendered}`)

  // Verify it's on the Leads & Bids board with the right value.
  let boardOk = false
  if (projId) {
    const { data: lead } = await admin.from('leads').select('est_value, project_name').eq('project_id', projId).maybeSingle()
    boardOk = !!lead && Math.abs(Number(lead.est_value) - 32261) < 1
    check('5. lands on Leads & Bids with base_total value', boardOk, lead ? `"${lead.project_name}" $${lead.est_value}` : 'no lead')
  }

  await b.close()

  // Cleanup the estimate this test created.
  if (projId) {
    await admin.from('leads').delete().eq('project_id', projId)
    await admin.from('projects').delete().eq('id', projId)
    await admin.from('customers').delete().eq('name', 'Scott Davidson')
  }

  const failed = results.filter((r) => !r.p)
  console.log('─'.repeat(64))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
