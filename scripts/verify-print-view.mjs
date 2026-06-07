/**
 * Phase 9-lite — Print view visual verification harness (Path B).
 *
 * Autonomous via service-role session injection. No magic link, no
 * email, no human interaction required.
 *
 * Flow:
 *   1. Load SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VERIFY_USER_EMAIL from .env.local
 *   2. Use admin API: generateLink('magiclink') → verifyOtp(hashed_token) → real session
 *   3. Inject session into Playwright context's localStorage via addInitScript
 *   4. Navigate to the print view — browser is "already authenticated"
 *   5. Capture: 01-screen-view.png, 02-print-media.png, 03-output.pdf, 04-mobile-view.png
 *
 * Usage:
 *   npm run verify:print
 *
 *   Optional env overrides:
 *     PRINT_URL       full URL to print at (overrides seeded proposal)
 *     DEV_SERVER_URL  default http://localhost:5174
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync } from 'fs'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_USER_EMAIL = process.env.VERIFY_USER_EMAIL || 'ianm@blueclawassociates.com'
const DEV_SERVER_URL = process.env.DEV_SERVER_URL || 'http://localhost:5174'

// Env validation — fail loud, never log the key value
if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL in .env.local')
  process.exit(1)
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')
  console.error('  Get it from Supabase dashboard -> Project Settings -> API -> service_role')
  console.error('  DO NOT prefix with VITE_ (would expose to browser).')
  process.exit(1)
}
if (SUPABASE_SERVICE_ROLE_KEY.startsWith('VITE_')) {
  console.error('SUPABASE_SERVICE_ROLE_KEY has VITE_ prefix - SECURITY ISSUE')
  console.error('  Service role key MUST NOT be exposed to the browser.')
  process.exit(1)
}

console.log('Generating session for', TEST_USER_EMAIL, 'via service-role admin API...')

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Step A: generateLink returns a hashed_token we can verify ourselves
const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: TEST_USER_EMAIL,
})
if (linkError || !linkData?.properties?.hashed_token) {
  console.error('Failed to generate magic link via admin API:', linkError)
  process.exit(1)
}

// Step B: verifyOtp converts hashed_token -> real session (no email round-trip)
const { data: sessionData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
  token_hash: linkData.properties.hashed_token,
  type: 'magiclink',
})
if (verifyError || !sessionData?.session) {
  console.error('Failed to verify OTP:', verifyError)
  process.exit(1)
}

const session = sessionData.session
console.log(
  'Session obtained for',
  session.user.email,
  '(expires in',
  session.expires_in,
  'sec)'
)

// Step C: inject session into Playwright's localStorage via addInitScript
// (runs before page scripts on every navigation)
// The Supabase JS SDK stores at key: sb-{project_ref}-auth-token
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
const authStorageKey = `sb-${projectRef}-auth-token`

mkdirSync('verifications/print', { recursive: true })
const browser = await chromium.launch()

try {
  // Resolve project_id for the seeded proposal via admin client
  const SEEDED_PROPOSAL_ID = '5e3e0c1e-8886-4877-a6e8-99cc07b87035'
  const { data: proposalRow, error: pErr } = await supabaseAdmin
    .from('proposals')
    .select('project_id')
    .eq('id', SEEDED_PROPOSAL_ID)
    .single()
  if (pErr || !proposalRow?.project_id) {
    console.error('Could not resolve project_id for seeded proposal:', pErr)
    await browser.close()
    process.exit(1)
  }
  const projectId = proposalRow.project_id

  const PROPOSAL_URL =
    process.env.PRINT_URL ||
    `${DEV_SERVER_URL}/app/projects/${projectId}/proposals/${SEEDED_PROPOSAL_ID}/print`
  console.log('Navigating to', PROPOSAL_URL)

  // --- Desktop context with session injected ---
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  await desktopContext.addInitScript(
    ({ authStorageKey, payload }) => {
      window.localStorage.setItem(authStorageKey, payload)
    },
    {
      authStorageKey,
      payload: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }),
    }
  )

  const desktopPage = await desktopContext.newPage()
  await desktopPage.goto(PROPOSAL_URL, { waitUntil: 'networkidle' })
  await desktopPage.waitForTimeout(1500)

  // Sanity check: did we land on the print view (not redirected to /login)?
  const currentUrl = desktopPage.url()
  if (currentUrl.includes('/login') || currentUrl === DEV_SERVER_URL + '/') {
    console.error('Got redirected to', currentUrl, '- session injection failed.')
    console.error('  Check: SUPABASE_URL matches the URL the dev server uses')
    console.error('  Check: localStorage key format is correct for this project ref')
    await browser.close()
    process.exit(1)
  }

  console.log('Capturing 01-screen-view.png')
  await desktopPage.screenshot({
    path: 'verifications/print/01-screen-view.png',
    fullPage: true,
  })

  console.log('Applying print emulation')
  await desktopPage.emulateMedia({ media: 'print' })
  await desktopPage.waitForTimeout(500)

  console.log('Capturing 02-print-media.png')
  await desktopPage.screenshot({
    path: 'verifications/print/02-print-media.png',
    fullPage: true,
  })

  console.log('Generating 03-output.pdf')
  await desktopPage.pdf({
    path: 'verifications/print/03-output.pdf',
    format: 'Letter',
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="font-size:9px; width:100%; text-align:center; color:#888;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  })

  await desktopContext.close()

  // --- Mobile context ---
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
  })
  await mobileContext.addInitScript(
    ({ authStorageKey, payload }) => {
      window.localStorage.setItem(authStorageKey, payload)
    },
    {
      authStorageKey,
      payload: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }),
    }
  )

  const mobilePage = await mobileContext.newPage()
  await mobilePage.goto(PROPOSAL_URL, { waitUntil: 'networkidle' })
  await mobilePage.waitForTimeout(1500)

  console.log('Capturing 04-mobile-view.png')
  await mobilePage.screenshot({
    path: 'verifications/print/04-mobile-view.png',
    fullPage: true,
  })

  await mobileContext.close()
} finally {
  await browser.close()
}

console.log('')
console.log('Verification artifacts saved:')
console.log('  verifications/print/01-screen-view.png')
console.log('  verifications/print/02-print-media.png')
console.log('  verifications/print/03-output.pdf')
console.log('  verifications/print/04-mobile-view.png')
