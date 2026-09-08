// qbo-callback — where Intuit sends the contractor after they approve.
//
// GET ?code=…&state=…&realmId=… . The state row written by qbo-connect
// says whose account this is; it is consumed once. The code is exchanged
// for tokens, the company name is read, and the connection row is
// written with both tokens encrypted. Then a redirect back into the app.
//
// verify_jwt is OFF because the browser arrives here from Intuit with no
// Supabase session header. The one-time state is the credential; a
// request with no valid state does nothing but redirect with an error.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { environment, exchangeCode, log, storeTokens, type Row } from './qbo_shared.ts'

function appUrl(): string {
  return (Deno.env.get('APP_URL') ?? 'https://bluebidclaw.app').replace(/\/$/, '')
}

function back(returnTo: string, params: Record<string, string>): Response {
  const url = new URL(appUrl() + (returnTo.startsWith('/') ? returnTo : '/app/settings'))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return Response.redirect(url.toString(), 302)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const u = new URL(req.url)
  const code = u.searchParams.get('code') ?? ''
  const state = u.searchParams.get('state') ?? ''
  const realmId = u.searchParams.get('realmId') ?? ''
  const intuitError = u.searchParams.get('error')

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Resolve the state first, whatever else happened, so the redirect can
  // land where the contractor started.
  const { data: st } = state
    ? await service.from('qbo_oauth_states').select('*').eq('state', state).maybeSingle()
    : { data: null }
  const returnTo = ((st as Row | null)?.return_to as string | undefined) ?? '/app/settings'
  if (st) await service.from('qbo_oauth_states').delete().eq('state', state)

  if (!st) return back('/app/settings', { qbo: 'error', reason: 'That connection link is not valid. Try again from Settings.' })
  // States older than 15 minutes are stale, whatever they say.
  if (Date.now() - new Date((st as Row).created_at).getTime() > 15 * 60 * 1000) {
    return back(returnTo, { qbo: 'error', reason: 'That connection link expired. Try again from Settings.' })
  }
  const userId = (st as Row).user_id as string

  if (intuitError) {
    await log(service, userId, { kind: 'connect', status: 'error', message: intuitError })
    return back(returnTo, { qbo: 'error', reason: intuitError === 'access_denied' ? 'You cancelled on the QuickBooks side.' : intuitError })
  }
  if (!code || !realmId) {
    return back(returnTo, { qbo: 'error', reason: 'QuickBooks did not send a code back.' })
  }

  try {
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/qbo-callback`
    const tokens = await exchangeCode(code, redirectUri)

    // The company's name, for the settings card. Best-effort.
    let companyName: string | null = null
    try {
      const host = environment() === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'
      const res = await fetch(`${host}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=73`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      })
      if (res.ok) {
        const info = (await res.json()) as Row
        companyName = info?.CompanyInfo?.CompanyName ?? null
      }
    } catch {
      /* name is cosmetic */
    }

    await storeTokens(service, userId, realmId, tokens, {
      company_name: companyName,
      connected_at: new Date().toISOString(),
      last_error: null,
    })
    await log(service, userId, { kind: 'connect', status: 'ok', qbo_id: realmId, message: companyName })
    return back(returnTo, { qbo: 'connected' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('qbo-callback:', msg)
    await log(service, userId, { kind: 'connect', status: 'error', message: msg })
    return back(returnTo, { qbo: 'error', reason: 'QuickBooks did not complete the connection. Try again.' })
  }
})
