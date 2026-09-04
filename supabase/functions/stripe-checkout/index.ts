// stripe-checkout — start a subscription.
//
// Takes a tier + billing interval, resolves the Stripe Price id from
// subscription_tier_limits, and returns a Checkout Session URL. The client
// sends the tier NAME, never a price id: a caller who could name its own
// price could subscribe itself to a $0 price it created. The price is only
// ever read from the table, server-side.
//
// Pairs with stripe-webhook, which is what actually grants the plan. This
// function grants NOTHING — a completed checkout that never produces a
// webhook leaves the account exactly as it was. That is deliberate: the
// browser is not a trustworthy witness to a payment.

import Stripe from 'npm:stripe@17'
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

type Interval = 'monthly' | 'annual'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) {
    // Configuration error, not the contractor's problem — say so plainly
    // rather than surfacing a Stripe exception.
    return json({ error: 'Billing is not configured yet.' }, 500)
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Not signed in.' }, 401)

  let body: { tier?: string; interval?: string; return_url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const tier = String(body.tier ?? '')
  const interval = (body.interval ?? 'monthly') as Interval
  if (interval !== 'monthly' && interval !== 'annual') {
    return json({ error: 'Unknown billing interval.' }, 400)
  }
  // 'free' and 'founder' are not purchasable; pro_ai_plus is dormant.
  if (tier !== 'pro' && tier !== 'pro_ai') {
    return json({ error: 'Unknown plan.' }, 400)
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Resolve the price from the TABLE, never from the request ────────
  const { data: tierRow } = await service
    .from('subscription_tier_limits')
    .select('stripe_price_id_monthly, stripe_price_id_annual, display_name')
    .eq('tier', tier)
    .maybeSingle()
  const priceId =
    interval === 'annual'
      ? (tierRow?.stripe_price_id_annual as string | null)
      : (tierRow?.stripe_price_id_monthly as string | null)
  if (!priceId) {
    // A tier with no price id configured is not "buy it anyway" — refuse,
    // so a half-configured install can never take money against a guess.
    return json(
      { error: 'That plan is not available for purchase yet.' },
      409
    )
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2025-10-29.clover' })

  // The table may hold a PRICE id or a PRODUCT id. Stripe's dashboard puts
  // the product id in front of you far more prominently than the price id,
  // so "paste the id" reliably produces prod_... — and a subscription line
  // item needs price_.... Resolving it here costs one API call on a page
  // the user is about to leave anyway, and removes a whole class of
  // silent misconfiguration.
  let resolvedPrice = priceId
  if (priceId.startsWith('prod_')) {
    const product = await stripe.products.retrieve(priceId)
    const def = product.default_price
    resolvedPrice = typeof def === 'string' ? def : (def?.id ?? '')
    if (!resolvedPrice) {
      // A product with no default price is ambiguous, not guessable: it may
      // have several, and picking one would charge an amount nobody chose.
      return json(
        {
          error:
            'That plan is misconfigured — its Stripe product has no default price set.',
        },
        409
      )
    }
  }

  // ── One Stripe customer per account, reused ─────────────────────────
  // Without this, every checkout makes a new customer and the portal shows
  // one subscription per attempt.
  const { data: settings } = await service
    .from('company_settings')
    .select('stripe_customer_id, company_legal_name')
    .eq('user_id', user.id)
    .maybeSingle()

  let customerId = settings?.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: (settings?.company_legal_name as string) || undefined,
      // The link back to BidClaw. The webhook trusts THIS over the email,
      // because an email can be changed in Stripe's own dashboard.
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await service
      .from('company_settings')
      .update({ stripe_customer_id: customerId })
      .eq('user_id', user.id)
  }

  // Where Stripe sends them back. Only same-origin returns are honoured —
  // an open redirect here would be a phishing primitive on a billing page.
  const origin = req.headers.get('origin') ?? ''
  const allowedOrigin =
    origin && /^https:\/\/([a-z0-9-]+\.)*bluebidclaw\.app$/.test(origin)
      ? origin
      : 'https://bluebidclaw.app'

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: resolvedPrice, quantity: 1 }],
    success_url: `${allowedOrigin}/app/settings?checkout=success`,
    cancel_url: `${allowedOrigin}/app/settings?checkout=cancelled`,
    allow_promotion_codes: true,
    // Carried onto the subscription so the webhook can identify the account
    // even if the customer record is later edited by hand.
    subscription_data: { metadata: { supabase_user_id: user.id } },
    client_reference_id: user.id,
  })

  return json({ url: session.url })
})
