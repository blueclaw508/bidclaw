-- 0030 — Subscription gate: one free proposal for life, then subscribe.
--
-- Ian, 2026-09-04: "I'd like for them to be able to do one estimate/proposal
-- for free once they register" — then watermark it and block sending until
-- they subscribe.
--
-- Two enforcement points, and only ONE of them is real:
--
--   • The WATERMARK is client-side CSS on the print view. It is a conversion
--     lever, not a lock — a determined user can delete the element in
--     devtools. That is an accepted trade (see the PR); it is not the thing
--     standing between a free account and a sent proposal.
--   • THIS FILE is the lock. Postgres triggers, SECURITY DEFINER, no client
--     path around them: a free account cannot create a second proposal and
--     cannot move any proposal into a sent-or-beyond status. Everything the
--     browser does is decoration on top of these two rules.
--
-- Replaces 0018's 5-per-month meter. The old rule let a small contractor run
-- an entire business on the free tier and never pay.

-- ── Stripe columns ────────────────────────────────────────────────────
-- subscription_status stores Stripe's status verbatim rather than a
-- BidClaw-invented enum, so the webhook is a straight copy and there is no
-- mapping table to drift.
alter table public.company_settings
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz;

comment on column public.company_settings.subscription_status is
  'Stripe subscription status, verbatim (active/trialing/past_due/canceled/unpaid/incomplete). NULL = no Stripe record: a manually granted plan (founder, comp), which is honoured.';

create unique index if not exists company_settings_stripe_customer_id_key
  on public.company_settings (stripe_customer_id)
  where stripe_customer_id is not null;

-- ── The single entitlement predicate ──────────────────────────────────
-- Every gate below calls THIS, so the create rule, the send rule and the
-- client can never disagree about who is paid up.
--
-- past_due counts as entitled on purpose: Stripe retries a failed card for
-- days, and cutting a paying contractor off mid-job over a temporary
-- decline costs more than the days of access it saves. Access ends at
-- canceled / unpaid / incomplete_expired, which is when Stripe itself has
-- given up.
create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_settings cs
    where cs.user_id = p_user_id
      and cs.plan is distinct from 'free'
      -- NULL status = granted outside Stripe (founder / comped). Honoured.
      and coalesce(cs.subscription_status, 'active')
          in ('active', 'trialing', 'past_due')
  );
$$;

-- ── Gate 1: one proposal for life on the free tier ────────────────────
create or replace function public.enforce_estimate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_count   integer;
begin
  select p.user_id into v_user_id from public.projects p where p.id = new.project_id;
  if v_user_id is null then
    return new; -- orphan/unknown owner — don't block
  end if;

  if public.has_active_subscription(v_user_id) then
    return new;
  end if;

  -- Lifetime, not monthly: the free tier is a trial, not a plan.
  select count(*) into v_count
  from public.proposals pr
  join public.projects pj on pj.id = pr.project_id
  where pj.user_id = v_user_id;

  if v_count >= 1 then
    raise exception 'free_proposal_used'
      using errcode = 'P0001',
            hint = 'Your free proposal has been used. Subscribe to create more.';
  end if;

  return new;
end;
$$;

-- ── Gate 2: a free proposal can be built and printed, never sent ──────
-- Blocks every status at or past 'sent', not just 'sent' itself — otherwise
-- setting a proposal straight to Approved would walk around the gate.
create or replace function public.enforce_send_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- Only a transition INTO a sent-or-beyond status is interesting. A row
  -- already at that status being edited for any other reason passes.
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('sent', 'approved', 'in_progress', 'completed') then
    return new;
  end if;

  select p.user_id into v_user_id from public.projects p where p.id = new.project_id;
  if v_user_id is null then
    return new;
  end if;

  if public.has_active_subscription(v_user_id) then
    return new;
  end if;

  raise exception 'subscription_required_to_send'
    using errcode = 'P0001',
          hint = 'Subscribe to send proposals. Your free proposal can be built and previewed, but prints watermarked.';
end;
$$;

drop trigger if exists enforce_send_gate_trg on public.proposals;
create trigger enforce_send_gate_trg
  before update on public.proposals
  for each row execute function public.enforce_send_gate();

-- ── Tier table: free is now a one-shot trial ──────────────────────────
-- monthly_manual_proposals is the MONTHLY meter and no longer describes the
-- free tier at all; the lifetime rule lives in the trigger above. Set to 0
-- so nothing reads it as a monthly allowance.
update public.subscription_tier_limits
set monthly_manual_proposals = 0,
    display_name = 'Free trial'
where tier = 'free';

-- Price points are Ian's to set — stripe_price_id and monthly_price_usd are
-- deliberately left as they are. The checkout function reads price ids from
-- THIS table, so changing plans is a data edit, never a code change.
