// kyn-login — sign in to BidClaw with a Know Your Numbers password.
//
// WHY THIS EXISTS. Ian's rule: one login for both products. KYN and BidClaw
// are separate Supabase projects with separate user pools, so a KYN
// password means nothing to BidClaw's auth server on its own. The bridge
// is this: verify the password against KYN, and if KYN accepts it, make it
// the BidClaw password too. From then on the ordinary BidClaw sign-in
// works, and if the contractor later changes their KYN password the next
// BidClaw attempt fails, comes back through here, and re-mirrors.
//
// The browser only calls this AFTER BidClaw's own sign-in has refused the
// password. Nobody who already has a working BidClaw password touches it.
//
// WHAT IT WILL NOT DO. It never creates an account the allowlist would
// refuse: the check runs here first, and the BEFORE INSERT trigger on
// auth.users runs again underneath. It never returns anything about an
// address that is not on the allowlist beyond the same sentence the
// magic-link form shows. It does not accept a user id, only the email and
// password the person typed, and it accepts nothing that KYN itself does
// not accept.
//
// verify_jwt is OFF for this function by necessity — the caller has no
// session yet, which is the whole point. The password is the credential.

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// One sentence for every "no". Distinguishing "not on the allowlist" from
// "wrong password" from "no KYN account" would let a stranger map which
// addresses exist. The allowlist form already says the lockdown line, so
// that one case keeps its wording; everything else is this.
const REFUSED = 'Wrong email or password.'
const LOCKDOWN =
  'This email is not authorized for BidClaw during the Phase 1 lockdown.'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const kynUrl = Deno.env.get('KYN_SUPABASE_URL')
  const kynServiceKey = Deno.env.get('KYN_SERVICE_ROLE_KEY')
  if (!kynUrl || !kynServiceKey) {
    // Same two secrets kyn-sync needs. Without them there is no bridge, and
    // the form falls back to "wrong password" — which for a KYN-only
    // contractor is exactly what they will see until Ian sets them.
    return json({ error: REFUSED, code: 'NOT_CONFIGURED' }, 503)
  }

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !email.includes('@') || password.length < 6) {
    return json({ error: REFUSED }, 401)
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // ── Allowlist first ─────────────────────────────────────────────────
  // Before any password is tried anywhere: a stranger must not be able to
  // use BidClaw as a password oracle against KYN accounts.
  const { data: allowed, error: allowErr } = await service.rpc('is_email_allowed', {
    p_email: email,
  })
  if (allowErr) {
    console.error('kyn-login: allowlist check failed:', allowErr.message)
    return json({ error: REFUSED }, 503)
  }
  if (allowed !== true) return json({ error: LOCKDOWN, code: 'NOT_ALLOWED' }, 403)

  // ── Verify against KYN ──────────────────────────────────────────────
  // A throwaway client: no session is kept, nothing is written to KYN.
  // The service key doubles as the apikey for the password grant, so no
  // third secret is needed.
  const kyn = createClient(kynUrl, Deno.env.get('KYN_ANON_KEY') ?? kynServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: kynSession, error: kynErr } = await kyn.auth.signInWithPassword({
    email,
    password,
  })
  if (kynErr || !kynSession?.user) {
    // Wrong password, no KYN account, or KYN rate-limiting this address —
    // one answer for all three.
    return json({ error: REFUSED, code: 'KYN_REFUSED' }, 401)
  }
  // Belt and braces: KYN's user must carry the very address we checked.
  if ((kynSession.user.email ?? '').trim().toLowerCase() !== email) {
    return json({ error: REFUSED }, 401)
  }

  // ── Mirror onto BidClaw ─────────────────────────────────────────────
  // auth.users is not reachable through PostgREST; the admin API pages
  // instead. BidClaw's user count is tiny, and this only runs on a failed
  // sign-in, so the page walk is cheap in practice.
  let existingId: string | null = null
  for (let page = 1; page <= 20 && !existingId; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('kyn-login: listUsers failed:', error.message)
      return json({ error: REFUSED }, 503)
    }
    const users = data?.users ?? []
    if (users.length === 0) break
    const hit = users.find((u) => (u.email ?? '').trim().toLowerCase() === email)
    if (hit) existingId = hit.id
  }

  if (existingId) {
    const { error } = await service.auth.admin.updateUserById(existingId, { password })
    if (error) {
      console.error('kyn-login: password mirror failed:', error.message)
      return json({ error: REFUSED }, 503)
    }
    return json({ ok: true, created: false })
  }

  // First time here: create the BidClaw account with the KYN password.
  // email_confirm because KYN already confirmed this address — making them
  // click a second confirmation email for the same inbox is the exact
  // friction this function exists to remove. The signup trigger still runs
  // and still applies any tier the allowlist row carries.
  const { error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    console.error('kyn-login: createUser failed:', createErr.message)
    // The allowlist trigger is the one thing that can refuse here.
    return json({ error: LOCKDOWN, code: 'NOT_ALLOWED' }, 403)
  }
  return json({ ok: true, created: true })
})
