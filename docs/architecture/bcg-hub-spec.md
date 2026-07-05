# BCG Hub — Central Identity + Billing Architecture (v0.1 draft)

**Author:** Claude Code · **Date:** 2026-07-05 · **Owner:** Ian McCarthy / Blue Claw Group
**Decision locked:** stay in the Supabase stack (shared Supabase Auth), no third-party SSO vendor.
**Status:** DRAFT for council review — no code until reviewed.

---

## 1. Goal

One universal user identity across every Blue Claw app; access gated by a paid
subscription; and a single central directory of BCG clients and what each has
subscribed to. Today each app is a **separate Supabase project with its own auth
(separate user pool)** — a customer would sign up 6 times and there is no one
place that knows who all the customers are.

## 2. Apps in scope

| App | Supabase ref | Customer-facing paywall? |
|---|---|---|
| KYN Online | tffkbanwwfeqmvgdjrzb | Yes (subscription SaaS) |
| BidClaw | cdjpzvyqvohwmlmquldt | Yes (freemium + AI tier) — **pilot** |
| CashClaw | zocusbsibabfuenyloyp | Yes |
| PO Desk | ojkqosycwlazwqqizflo | Yes (has a dashboard) |
| Social Autopilot | qwwshxirvmqjcrhzfjdl | **TBD** — internal backend today |
| Jarvis | mbkbudarmuxclvlauudw | **TBD** — Ian's private command center |

> Social Autopilot and Jarvis have no customer login today. Decide per-app
> whether they join the universal-user world (get productized with a paywall)
> or stay internal (out of scope). Ian priced all six, so treat them as
> eventual products but sequence them last.

## 3. Architecture: the Hub

A **new dedicated Supabase project — "BCG Hub"** — owns three things and only
these three. Apps keep their own data projects; they defer *identity* and
*billing* to the hub.

```
                 ┌──────────────────────── BCG HUB (new Supabase) ───────────────────────┐
                 │  • Supabase Auth  = the ONE user pool (shared login)                   │
   Stripe ──────▶│  • clients        = the BCG client directory                          │
  (webhooks)     │  • products       = sellable apps × tiers                             │
                 │  • subscriptions  = client × product × tier × status (Stripe-fed)      │
                 │  • edge fns: create-checkout · stripe-webhook · check-entitlement      │
                 └───────▲───────────────────────────────▲───────────────────────────────┘
                         │ hub-issued JWT                 │ entitlement query
      ┌──────────────────┼──────────────┐   ┌────────────┼─────────────┐
      │ BidClaw (own DB) │ CashClaw (DB) │   │ KYN (DB)   │ PO Desk (DB) │  … each app:
      │  trusts hub JWT  │               │   │            │              │   auth via hub,
      │  RLS = hub uid   │               │   │            │              │   gate on entitlement,
      └──────────────────┴──────────────┘   └────────────┴──────────────┘   own data stays put
```

### 3.1 Shared identity (the crux)

- The **hub's Supabase Auth is the identity provider**. Every app's frontend
  runs `signIn/signUp/getSession` against the **hub's** Supabase URL + anon key,
  not its own.
- Each app's **data** project must then **trust hub-issued JWTs** so its RLS
  `auth.uid()` resolves to the universal hub user id. On current Supabase the
  candidate mechanisms (confirm the exact supported path in council/impl):
  1. **Asymmetric JWT signing keys / JWKS** — point each app project at the
     hub's JWKS so it validates hub tokens. (Preferred if supported cleanly.)
  2. **Shared JWT secret** across hub + app projects — simplest conceptually,
     but rotating a shared secret is sensitive and couples all projects.
  3. **Supabase "third-party auth"** — designed for external issuers (Clerk,
     etc.); whether another Supabase project is a valid issuer needs checking.
- **Rejected alternative:** consolidating all app data into the hub project.
  Cleaner auth, but a massive data migration and it couples every app. Keep app
  data separate; federate *auth* only.

### 3.2 Entitlement gate

- After login, an app calls the hub edge fn `check-entitlement(product_key)` (or
  reads a hub `entitlements` view with the shared token) → returns the client's
  active tier for that product (e.g. BidClaw → `free | pro | pro_ai`).
- The app gates access + features on that tier and caches it for the session.
- **BidClaw is already shaped for this:** its `company_settings.plan` +
  `jamie_enabled` + `src/lib/entitlements.ts` become **hub-fed** with a one-
  function swap — the gate/trigger stay, only the *source* of `plan` changes.

### 3.3 Billing (Stripe = source of truth)

- One Stripe account; a Product+Price per app-tier (prices from the canonical
  BCG pricing table).
- Checkout: app → hub `create-checkout(product, tier)` → Stripe Checkout → back.
- Webhook: Stripe → hub `stripe-webhook` → upsert `subscriptions`. The hub's
  `entitlements` view is the fast read-cache of Stripe state (no per-request
  Stripe calls from apps).

## 4. Hub data model (sketch)

```
clients          (id = auth.users.id, email, full_name, company_name, created_at)
products         (key PK: 'bidclaw'|'kyn'|'cashclaw'|'po_desk'|..., name, tiers jsonb)
stripe_customers (client_id → stripe_customer_id)
subscriptions    (id, client_id, product_key, tier, status, stripe_subscription_id,
                  current_period_end, canceled_at, created_at)
entitlements     (VIEW: client_id × product_key → active tier, derived from
                  subscriptions where status in ('active','trialing'))
```

RLS on the hub: a client sees only their own clients/subscriptions rows; the
edge functions (service role) write subscriptions from Stripe webhooks.

## 5. Migration plan (phased, lowest-risk first)

- **Phase 0 — Build the hub.** New Supabase project + schema + Stripe products
  + the 3 edge functions. No app cutover yet. Seed `products` from the pricing
  table. (Also: a comped/owner entitlement path so Ian keeps full access.)
- **Phase 1 — Pilot: BidClaw.** Lowest risk — it's Phase-1-locked (one user,
  Ian) and already has the entitlement seams. Repoint its auth at the hub, make
  its data project trust hub JWTs, swap `entitlements.ts` to read the hub, wire
  the UpgradeModal CTA → hub checkout, migrate Ian's single user in.
- **Phase 2 — CashClaw, KYN Online, PO Desk.** Each: repoint auth, trust hub
  JWT, entitlement gate, checkout. **Careful** — these have real data whose RLS
  ownership (`user_id`) is keyed to the *old* per-app auth.users; migrating
  identity to the hub means remapping owned rows to the hub user id.
- **Phase 3 — Social Autopilot / Jarvis.** Decide productize-with-paywall vs
  stay-internal.

## 6. Risks / open questions (for the council)

1. **JWT federation mechanism** — which of §3.1's options is the clean,
   currently-supported Supabase path? This is the load-bearing technical
   assumption; the whole design rests on apps trusting hub tokens.
2. **Existing-user identity remap** — every app's RLS is `auth.uid() = user_id`.
   If the hub user id ≠ the current per-app id, every owned row's `user_id` must
   be remapped. Trivial for BidClaw (1 user, locked); real work for CashClaw
   (live financial data), KYN, PO Desk. Sequence by data-migration risk.
3. **Single point of failure** — hub down = every app's login down. Mitigate
   with Supabase uptime + per-app entitlement caching + graceful degradation.
4. **Comped / internal access** — Ian (and staff) must never be locked out of
   his own tools by the paywall. Need an owner/comp entitlement path.
5. **Per-app-vs-per-company seats** — is a "client" a person or a company with
   multiple seats? Affects the `clients` model. (BidClaw/KYN feel per-company.)
6. **Is now the right time?** Doing this pre-real-customers is cheap; but it also
   front-loads work before revenue. Council: build-now vs thin-slice-later.

## 7. What's already done (hub-ready seams)

- BidClaw: `company_settings.plan` (free/pro/pro_ai) + `jamie_enabled` + the
  server-side estimate-limit trigger + `src/lib/entitlements.ts`. When the hub
  lands, `plan` becomes hub-fed; nothing here gets ripped out.
- Canonical pricing table exists (all six apps, confirmed).
