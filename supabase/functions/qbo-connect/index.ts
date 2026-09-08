// qbo-connect — start the QuickBooks OAuth handshake.
//
// The signed-in contractor asks for a link; this writes a one-time state
// row (so the callback can tell whose company just authorized) and hands
// back Intuit's authorization URL. The browser goes there, the contractor
// picks their company and approves, and Intuit sends them to qbo-callback.
//
// verify_jwt ON: only a signed-in contractor can begin connecting.

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const clientId = Deno.env.get('QBO_CLIENT_ID')
  if (!clientId || !Deno.env.get('QBO_CLIENT_SECRET') || !Deno.env.get('QBO_TOKEN_KEY')) {
    return json({ error: 'QuickBooks is not configured yet.', code: 'NOT_CONFIGURED' }, 503)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Not signed in.' }, 401)

  let body: { return_to?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  // Only a path on our own app, never an arbitrary URL.
  const returnTo = typeof body.return_to === 'string' && body.return_to.startsWith('/') ? body.return_to.slice(0, 200) : '/app/settings'

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const { error } = await service.from('qbo_oauth_states').insert({ state, user_id: user.id, return_to: returnTo })
  if (error) return json({ error: `Could not start the connection: ${error.message}` }, 500)

  // The callback URL must match what is registered on the Intuit app,
  // character for character.
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/qbo-callback`
  const url = new URL('https://appcenter.intuit.com/connect/oauth2')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  return json({ url: url.toString() })
})
