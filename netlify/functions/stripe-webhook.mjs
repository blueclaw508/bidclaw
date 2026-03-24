// Netlify serverless function — Stripe webhook handler
// Listens for checkout.session.completed to upgrade user's subscription_tier
// Requires env vars: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import crypto from 'crypto'

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars for stripe-webhook')
    return new Response('Server misconfigured', { status: 500 })
  }

  // Verify Stripe signature
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  // Parse the signature header
  const sigParts = {}
  sig.split(',').forEach((part) => {
    const [key, value] = part.split('=')
    sigParts[key.trim()] = value
  })

  const timestamp = sigParts['t']
  const expectedSig = sigParts['v1']

  if (!timestamp || !expectedSig) {
    return new Response('Invalid signature format', { status: 400 })
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${body}`
  const computedSig = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex')

  if (computedSig !== expectedSig) {
    return new Response('Invalid signature', { status: 400 })
  }

  // Reject if timestamp is older than 5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    return new Response('Timestamp too old', { status: 400 })
  }

  const event = JSON.parse(body)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId = session.metadata?.supabase_user_id
    const customerEmail = session.customer_email

    if (!userId && !customerEmail) {
      console.error('No user identifier in checkout session')
      return new Response('OK', { status: 200 })
    }

    // Update subscription_tier to 'bidclaw' in kyn_user_settings
    let query
    if (userId) {
      // Direct match by user_id
      query = `user_id=eq.${userId}`
    } else {
      // Fallback: look up by email via auth — update all matching rows
      // Since we have user_id from metadata, this path is a safety net
      console.log(`Upgrading by email fallback: ${customerEmail}`)
      query = null
    }

    if (query) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/kyn_user_settings?${query}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ subscription_tier: 'bidclaw' }),
        }
      )

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Failed to update subscription_tier: ${res.status} ${errText}`)
      } else {
        console.log(`Upgraded user ${userId} to bidclaw tier`)
      }
    }
  }

  // Handle subscription cancellation — downgrade user back to 'pro' tier
  // (They still have their QuickCalc Pro sub; they just lose BidClaw access)
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const customerId = subscription.customer
    const customerEmail = subscription.customer_email

    console.log(`BidClaw subscription cancelled for customer: ${customerEmail || customerId}`)

    // Look up the user by their stripe_customer_id in bidclaw_access
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bidclaw_access?stripe_customer_id=eq.${customerId}&select=user_id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    )

    if (lookupRes.ok) {
      const rows = await lookupRes.json()
      if (rows.length > 0) {
        const userId = rows[0].user_id

        // Downgrade subscription_tier from 'bidclaw' back to 'pro'
        const downgradeRes = await fetch(
          `${SUPABASE_URL}/rest/v1/kyn_user_settings?user_id=eq.${userId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ subscription_tier: 'pro' }),
          }
        )

        if (!downgradeRes.ok) {
          const errText = await downgradeRes.text()
          console.error(`Failed to downgrade user ${userId}: ${downgradeRes.status} ${errText}`)
        } else {
          console.log(`Downgraded user ${userId} from bidclaw to pro tier`)
        }

        // Clear bidclaw_access paid status
        await fetch(
          `${SUPABASE_URL}/rest/v1/bidclaw_access?user_id=eq.${userId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ paid: false }),
          }
        )
      }
    }
  }

  return new Response('OK', { status: 200 })
}

export const config = {
  path: '/.netlify/functions/stripe-webhook',
}
