// Netlify serverless function — creates a Stripe Checkout session for BidClaw upgrade
// Requires env vars: STRIPE_SECRET_KEY, STRIPE_BIDCLAW_PRICE_ID, SITE_URL

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
  const STRIPE_BIDCLAW_PRICE_ID = process.env.STRIPE_BIDCLAW_PRICE_ID
  const SITE_URL = process.env.URL || 'https://bidclaw.netlify.app'

  if (!STRIPE_SECRET_KEY || !STRIPE_BIDCLAW_PRICE_ID) {
    return new Response(
      JSON.stringify({ error: 'Stripe not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { user_email, user_id } = body

    if (!user_email) {
      return new Response(
        JSON.stringify({ error: 'user_email is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create Stripe Checkout Session via the REST API (no SDK needed)
    const params = new URLSearchParams()
    params.append('mode', 'subscription')
    params.append('line_items[0][price]', STRIPE_BIDCLAW_PRICE_ID)
    params.append('line_items[0][quantity]', '1')
    params.append('customer_email', user_email)
    params.append('success_url', `${SITE_URL}?upgraded=true`)
    params.append('cancel_url', `${SITE_URL}?upgraded=false`)
    if (user_id) {
      params.append('metadata[supabase_user_id]', user_id)
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `Stripe error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const session = await response.json()
    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const config = {
  path: '/.netlify/functions/create-checkout',
}
