// stripe-webhook — the ONLY thing that grants or revokes a paid plan.
//
// Deployed with verify_jwt FALSE, because Stripe calls it with no Supabase
// JWT. That makes the signature check the entire security model: without it
// anyone who found this URL could POST themselves onto pro_ai for free.
// Every path below refuses before it writes.
//
// What it writes, all on company_settings:
//   plan                    free | pro | pro_ai   (resolved from the PRICE)
//   jamie_enabled           true only on pro_ai
//   stripe_subscription_id
//   subscription_status     Stripe's status, verbatim
//   current_period_end
//
// has_active_subscription() (0030) reads those, and the create/send gates
// read that. So this function is the top of the entitlement chain.

import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

type ServiceClient = ReturnType<typeof createClient>

/** Tier a Stripe price belongs to, or null if we don't sell it. */
async function tierForPrice(
  service: ServiceClient,
  priceId: string | null,
  productForPrice: string | null
): Promise<string | null> {
  if (!priceId) return null
  // The id goes into a PostgREST .or() filter, which is a comma-and-dot
  // grammar rather than a bound parameter — a value containing either
  // would be parsed as filter syntax, not as text. Stripe ids are always
  // price_ plus [A-Za-z0-9], so anything else is refused rather than
  // escaped: there is no legitimate id this rejects.
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    console.error(`stripe-webhook: refusing malformed price id ${priceId}`)
    return null
  }
  const { data } = await service
    .from('subscription_tier_limits')
    .select('tier')
    .or(
      `stripe_price_id_monthly.eq.${priceId},stripe_price_id_annual.eq.${priceId}`
    )
    .maybeSingle()
  if (data?.tier) return data.tier as string

  // The column may hold a PRODUCT id instead (checkout accepts either and
  // resolves it). Stripe always reports the PRICE on the subscription, so
  // fall back to matching on the price's parent product.
  const productId = productForPrice
  if (productId && /^prod_[A-Za-z0-9]+$/.test(productId)) {
    const { data: byProduct } = await service
      .from('subscription_tier_limits')
      .select('tier')
      .or(
        `stripe_price_id_monthly.eq.${productId},stripe_price_id_annual.eq.${productId}`
      )
      .maybeSingle()
    if (byProduct?.tier) return byProduct.tier as string
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secretKey || !webhookSecret) {
    console.error('stripe-webhook is missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    // 500 so Stripe retries once the secrets are in, rather than treating
    // the event as delivered and dropping it.
    return new Response('Not configured', { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const stripe = new Stripe(secretKey, { apiVersion: '2025-10-29.clover' })
  const raw = await req.text()

  let event: Stripe.Event
  try {
    // constructEventASYNC — Deno's WebCrypto is async, and the sync variant
    // silently fails here. This is the line that makes the endpoint safe.
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      webhookSecret
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'bad signature'
    console.error('stripe-webhook rejected an unsigned/forged event:', msg)
    return new Response(`Signature verification failed: ${msg}`, { status: 400 })
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id

        // Identify the account by the customer id we stored at checkout.
        // metadata is the fallback for a subscription created by hand in
        // the Stripe dashboard.
        let userId: string | null = null
        const { data: byCustomer } = await service
          .from('company_settings')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()
        userId = (byCustomer?.user_id as string) ?? null
        if (!userId) {
          const metaId = sub.metadata?.supabase_user_id
          if (metaId) {
            const { data: byMeta } = await service
              .from('company_settings')
              .select('user_id')
              .eq('user_id', metaId)
              .maybeSingle()
            userId = (byMeta?.user_id as string) ?? null
            // First sighting via metadata — record the customer id so the
            // next event resolves on the fast path.
            if (userId) {
              await service
                .from('company_settings')
                .update({ stripe_customer_id: customerId })
                .eq('user_id', userId)
            }
          }
        }
        if (!userId) {
          // Not ours. 200 so Stripe stops retrying an event we can never
          // action — a subscription for a customer with no BidClaw account.
          console.error(`stripe-webhook: no account for customer ${customerId}`)
          return new Response('No matching account', { status: 200 })
        }

        const price = sub.items.data[0]?.price
        const priceId = price?.id ?? null
        const productId =
          typeof price?.product === 'string'
            ? price.product
            : (price?.product?.id ?? null)
        const paidTier = await tierForPrice(service, priceId, productId)

        // A subscription that is over, or one on a price we no longer sell,
        // drops the account to free. Deleting the plan is the same code
        // path as granting it — there is no separate "downgrade" branch to
        // forget to write.
        const ended =
          event.type === 'customer.subscription.deleted' ||
          sub.status === 'canceled' ||
          sub.status === 'unpaid' ||
          sub.status === 'incomplete_expired'
        const tier = ended ? 'free' : (paidTier ?? 'free')

        if (!ended && !paidTier) {
          console.error(
            `stripe-webhook: price ${priceId} maps to no tier — account left on free`
          )
        }

        const periodEnd = (sub as unknown as { current_period_end?: number })
          .current_period_end
        await service
          .from('company_settings')
          .update({
            plan: tier,
            // pro_ai is the only tier that includes Jamie.
            jamie_enabled: tier === 'pro_ai',
            stripe_subscription_id: ended ? null : sub.id,
            subscription_status: ended ? 'canceled' : sub.status,
            current_period_end: periodEnd
              ? new Date(periodEnd * 1000).toISOString()
              : null,
          })
          .eq('user_id', userId)
        break
      }

      // Checkout finishing is NOT what grants the plan — the subscription
      // events above are, and Stripe always sends those too. This branch
      // only makes sure the customer id is linked, so the very first
      // subscription event can find the account.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.client_reference_id
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id
        if (userId && customerId) {
          await service
            .from('company_settings')
            .update({ stripe_customer_id: customerId })
            .eq('user_id', userId)
        }
        break
      }

      default:
        // Everything else is acknowledged and ignored. Returning non-200
        // for an event we simply don't handle would make Stripe retry it
        // forever and eventually disable the endpoint.
        break
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`stripe-webhook failed on ${event.type}:`, msg)
    // 500 so Stripe retries — a dropped subscription event means a paying
    // customer stuck on free.
    return new Response('Handler error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
