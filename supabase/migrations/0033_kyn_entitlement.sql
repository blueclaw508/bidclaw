-- 0033 — KYN subscribers get BidClaw Pro, and lose it when KYN lapses.
--
-- Ian: "Let's give them pro for free if they have KYN… But if their KYN
-- lapses, then they can't get back into BidClaw."
--
-- The trap this schema exists to avoid: a single `plan` column cannot say
-- WHY someone is on Pro, so a KYN cancellation would happily downgrade a
-- contractor who is separately paying BidClaw $499 a month. Two independent
-- inputs, one derived answer.
--
--   paid_tier + subscription_status   ← what they PAY BidClaw for
--   kyn_granted_tier                  ← what a current KYN sub comps them to
--   plan                              ← DERIVED from both, never set directly
--
-- paid_tier is separate from plan on purpose. Reading the paid tier back off
-- `plan` would be circular: a KYN comp writes plan='pro', and the next
-- resolve would then read 'pro' as what a Pro+AI customer had bought and
-- quietly downgrade them from $499 to $39.
--
-- Precedence, highest first: a paid BidClaw subscription, then the KYN
-- grant, then free. A paying customer can never be downgraded by a KYN
-- event, and someone whose BidClaw subscription lapses falls back to their
-- KYN grant rather than to free.

alter table public.company_settings
  -- The tier a current KYN subscription comps this account to, or NULL when
  -- they have no live KYN subscription. A tier rather than a boolean: the
  -- alternative was resolving it by matching a product LABEL at read time,
  -- which turns renaming a Stripe product into a silent loss of entitlement.
  add column if not exists kyn_granted_tier text
    check (kyn_granted_tier is null or kyn_granted_tier in ('pro', 'pro_ai')),
  add column if not exists kyn_checked_at timestamptz,
  -- The tier this account's OWN BidClaw subscription buys. Set by the Stripe
  -- webhook from the price; NULL when they have no BidClaw subscription.
  add column if not exists paid_tier text
    check (paid_tier is null or paid_tier in ('pro', 'pro_ai')),
  -- Why they are on the plan they are on. Purely diagnostic — the gates read
  -- `plan` — but without it a support question ("why is this account Pro?")
  -- has no answer.
  add column if not exists plan_source text
    check (plan_source is null or plan_source in ('stripe', 'kyn', 'manual'));

comment on column public.company_settings.kyn_granted_tier is
  'Tier comped by a current KYN (BlueQuickCalc) subscription; NULL when KYN is not current. An INPUT to the plan, never the plan itself — see resolve_plan().';

comment on column public.company_settings.plan_source is
  'Why this account holds its plan: stripe = they pay BidClaw; kyn = comped via a KYN subscription; manual = granted by hand (founder, comp). Diagnostic only.';

-- Existing paid accounts are Stripe-sourced; the founder is manual.
update public.company_settings
set plan_source = case when plan = 'free' then null
                       when stripe_subscription_id is not null then 'stripe'
                       else 'manual' end,
    -- Backfill: an existing Stripe-paying account's plan IS its paid tier,
    -- because nothing has ever comped anyone yet.
    paid_tier = case when stripe_subscription_id is not null
                       and plan in ('pro', 'pro_ai') then plan end
where plan_source is null;

-- ── Which external products earn a BidClaw plan ───────────────────────
-- A table rather than a constant, so adding a KYN tier (or a future partner
-- product) is a data edit. Product ids, not price ids: KYN's monthly and
-- annual prices both sit under one product, and both should count.
create table if not exists public.partner_products (
  stripe_product_id text primary key,
  label             text not null,
  grants_tier       text not null references public.subscription_tier_limits(tier),
  created_at        timestamptz not null default now()
);

comment on table public.partner_products is
  'Stripe products from OTHER Blue Claw apps that entitle their subscriber to a BidClaw plan. KYN subscribers get Pro. Empty = nobody is comped.';

alter table public.partner_products enable row level security;

-- Readable by any signed-in user (the pricing UI says "included with KYN"),
-- writable only by the service role — an INSERT here grants free product.
drop policy if exists partner_products_read on public.partner_products;
create policy partner_products_read on public.partner_products
  for select to authenticated using (true);

-- ── The one place a plan is decided ───────────────────────────────────
create or replace function public.resolve_plan(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cs record;
begin
  select * into cs from public.company_settings where user_id = p_user_id;
  if not found then return 'free'; end if;

  -- 1. A live BidClaw subscription always wins, at the tier they BOUGHT —
  --    read from paid_tier, never from plan, which may itself be a comp.
  --    past_due counts (Stripe is still retrying the card), matching
  --    has_active_subscription().
  if cs.paid_tier is not null
     and coalesce(cs.subscription_status, 'active')
         in ('active', 'trialing', 'past_due') then
    return cs.paid_tier;
  end if;

  -- 1b. A plan granted by hand outside Stripe (founder, comp) is honoured —
  --     it has no paid_tier and no KYN link, and must survive both.
  if cs.plan_source = 'manual' and cs.plan is distinct from 'free' then
    return cs.plan;
  end if;

  -- 2. A current KYN subscription comps them to the tier it grants.
  if cs.kyn_granted_tier is not null then
    return cs.kyn_granted_tier;
  end if;

  -- 3. Nothing current. Back to the free trial — which, because their one
  --    free proposal is long spent, means they can still sign in and read
  --    their work but cannot create or send. That is the intended
  --    "can't get back in": locked out of USING it, not of their own history.
  return 'free';
end;
$$;

comment on function public.resolve_plan(uuid) is
  'The effective BidClaw tier for an account: paid subscription > KYN comp > free. Called after either input changes; never let a caller set `plan` directly.';

grant execute on function public.resolve_plan(uuid) to service_role;
