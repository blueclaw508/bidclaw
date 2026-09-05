-- 0036 — a KYN comp can lapse, and resolve_plan() finally decides things.
--
-- Ian's rule: KYN carries a free BidClaw Pro, and when the KYN subscription
-- ends the BidClaw Pro ends with it. Until now the comp was permanent —
-- nothing anywhere checked, and the only way to take one back was to edit a
-- row by hand.
--
-- Two ways a KYN subscription ends, and they need different mechanisms:
--
--   STRIPE-BILLED (panteralandscapes, bernal.jovanne). KYN bills through the
--   same Stripe account as BidClaw, so our webhook already receives their
--   cancellation events. We just have to recognise one. Event-driven, no
--   polling, no second set of credentials, no cron.
--
--   SOLD OFFLINE (kamayelandscapeanddesign). No Stripe subscription exists,
--   so no event will ever arrive. These carry a hard expiry date instead,
--   evaluated at read time — which also needs no job, and cannot drift
--   because there is nothing to run late.
--
-- WHY THIS TOUCHES has_active_subscription. resolve_plan() was written in
-- 0033 as the single answer to "what is this account entitled to" and has
-- never had a caller. Everything really read company_settings.plan. That was
-- survivable while a plan only ever came from one place; it stops being
-- survivable the moment an entitlement can EXPIRE, because a stored column
-- cannot notice that a date has passed. So the gates now ask resolve_plan(),
-- and `plan` becomes a materialised copy kept in step by sync_plan().

-- ────────────────────────────────────────────────────────────────────
-- What ties a comp to the subscription that justifies it
-- ────────────────────────────────────────────────────────────────────

alter table public.beta_allowlist
  add column if not exists kyn_subscription_id text,
  add column if not exists kyn_expires_at timestamptz;

alter table public.company_settings
  add column if not exists kyn_subscription_id text,
  add column if not exists kyn_expires_at timestamptz;

comment on column public.company_settings.kyn_subscription_id is
  'The Stripe subscription on the PARTNER product (KYN) that justifies this comp. '
  'Never a BidClaw subscription — that is stripe_subscription_id. The webhook '
  'matches cancellations against this.';
comment on column public.company_settings.kyn_expires_at is
  'Hard expiry for a comp with no Stripe subscription behind it (KYN sold '
  'offline). NULL means the comp lives or dies by kyn_subscription_id instead.';

-- Index because the webhook looks a comp up by subscription id on every
-- partner event, and there is no other reason to scan this column.
create index if not exists company_settings_kyn_subscription_id_idx
  on public.company_settings (kyn_subscription_id)
  where kyn_subscription_id is not null;

-- ────────────────────────────────────────────────────────────────────
-- resolve_plan v2 — expiry-aware, and safe to switch the gates onto
-- ────────────────────────────────────────────────────────────────────

create or replace function public.resolve_plan(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cs record;
begin
  select * into cs from public.company_settings where user_id = p_user_id;
  if not found then return 'free'; end if;

  -- 1. A PAID BidClaw subscription outranks everything.
  --
  -- subscription_status must be genuinely set — NULL fails this IN, which is
  -- exactly what we want. A comped account has a NULL status, and the old
  -- coalesce(status,'active') would have let it satisfy this branch on the
  -- strength of its materialised `plan`, returning the right answer for the
  -- wrong reason and skipping the expiry check three branches down.
  --
  -- paid_tier is what the webhook records now; `plan` is the fallback for any
  -- row written before it did, so shipping this cannot drop an existing
  -- customer to free.
  if cs.subscription_status in ('active', 'trialing', 'past_due')
     and coalesce(cs.paid_tier, nullif(cs.plan, 'free')) is not null then
    return coalesce(cs.paid_tier, cs.plan);
  end if;

  -- 2. Granted by hand — the founder, a comped friend. Never expires,
  --    never revoked by any automatic process. That is the whole point of
  --    'manual' being a separate source.
  if cs.plan_source = 'manual' and cs.plan is distinct from 'free' then
    return cs.plan;
  end if;

  -- 3. A partner comp (KYN), for as long as it is still good.
  if cs.kyn_granted_tier is not null
     and (cs.kyn_expires_at is null or cs.kyn_expires_at > now()) then
    return cs.kyn_granted_tier;
  end if;

  return 'free';
end;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- sync_plan — keep the materialised column honest
-- ────────────────────────────────────────────────────────────────────
--
-- company_settings.plan is what the BROWSER reads to draw buttons and
-- badges, and what the Jamie tier lookup keys off. resolve_plan() is the
-- truth. This is the one place that copies the second into the first, so
-- they cannot drift, and every write path calls it rather than setting
-- `plan` by hand.

create or replace function public.sync_plan(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan text;
begin
  v_plan := public.resolve_plan(p_user_id);
  update public.company_settings
  set plan = v_plan,
      -- pro_ai is the only tier that includes Jamie, however it was granted.
      jamie_enabled = (v_plan = 'pro_ai')
  where user_id = p_user_id;
  return v_plan;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- The gates now ask resolve_plan()
-- ────────────────────────────────────────────────────────────────────
--
-- enforce_estimate_limit and enforce_send_gate both call this, so this one
-- line is what makes an expired comp actually stop working — instantly, on
-- the next query, with nothing scheduled.

create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.resolve_plan(p_user_id) is distinct from 'free';
$function$;

-- The browser's copy of the same question. A no-argument wrapper on
-- auth.uid() rather than granting execute on resolve_plan(uuid), which would
-- let any signed-in user read any other account's plan by passing their id.
create or replace function public.my_plan()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.resolve_plan(auth.uid());
$function$;

revoke all on function public.my_plan() from public;
grant execute on function public.my_plan() to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- Revoking a comp
-- ────────────────────────────────────────────────────────────────────
--
-- Called by stripe-webhook when a PARTNER subscription ends. Idempotent, and
-- returns how many accounts it touched so the webhook can log something true.

create or replace function public.revoke_kyn_comp(p_subscription_id text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid;
  v_count integer := 0;
begin
  if p_subscription_id is null or p_subscription_id = '' then
    return 0;
  end if;

  for v_user in
    select user_id from public.company_settings
    where kyn_subscription_id = p_subscription_id
      and kyn_granted_tier is not null
  loop
    update public.company_settings
    set kyn_granted_tier = null,
        kyn_checked_at   = now(),
        -- Only clear the source if the comp was the reason. An account that
        -- was later granted something manually keeps that.
        plan_source = case when plan_source = 'kyn' then null else plan_source end
    where user_id = v_user;

    -- Recompute rather than assuming 'free'. Someone who bought BidClaw Pro
    -- on top of their comp keeps what they paid for — losing KYN must not
    -- cancel a BidClaw subscription.
    perform public.sync_plan(v_user);
    v_count := v_count + 1;
  end loop;

  -- And take the promise off the invite, so signing up again after the
  -- cancellation does not hand the comp straight back.
  update public.beta_allowlist
  set grant_tier = null,
      grant_source = null
  where kyn_subscription_id = p_subscription_id
    and grant_source = 'kyn';

  return v_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Carry the linkage onto new accounts
-- ────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tier text;
  v_slot integer;
  v_grant_tier   text;
  v_grant_source text;
  v_kyn_sub      text;
  v_kyn_expires  timestamptz;
begin
  v_tier := case
    when new.email = 'ianm@blueclawassociates.com' then 'ai_pro'
    else 'free'
  end;

  insert into public.profiles (id, email, subscription_tier)
  values (new.id, new.email, v_tier);

  insert into public.company_settings (user_id) values (new.id);

  select a.grant_tier, a.grant_source, a.kyn_subscription_id, a.kyn_expires_at
    into v_grant_tier, v_grant_source, v_kyn_sub, v_kyn_expires
  from public.beta_allowlist a
  where a.email = lower(trim(new.email));

  if v_grant_tier is not null then
    update public.company_settings
    set kyn_granted_tier = case when v_grant_source = 'kyn'
                                then v_grant_tier else null end,
        kyn_checked_at   = case when v_grant_source = 'kyn'
                                then now() else null end,
        -- What justifies the comp, so the webhook can revoke it later and an
        -- offline grant can expire on its own.
        kyn_subscription_id = case when v_grant_source = 'kyn'
                                   then v_kyn_sub else null end,
        kyn_expires_at      = case when v_grant_source = 'kyn'
                                   then v_kyn_expires else null end,
        plan_source = v_grant_source,
        -- A manual grant lives in `plan` itself; resolve_plan branch 2 reads
        -- it there. A KYN comp lives in kyn_granted_tier and is recomputed
        -- below, so it can expire.
        plan = case when v_grant_source = 'manual' then v_grant_tier else plan end
    where user_id = new.id;

    -- Materialise. Also the moment an already-expired invite quietly
    -- resolves to free instead of granting anything.
    perform public.sync_plan(new.id);
  end if;

  for v_slot in 1..5 loop
    insert into public.company_labor_types (user_id, slot_number)
    values (new.id, v_slot);
  end loop;

  for v_slot in 1..10 loop
    insert into public.company_equipment_rates (user_id, slot_number)
    values (new.id, v_slot);
  end loop;

  return new;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Link the existing comps, and add the offline one
-- ────────────────────────────────────────────────────────────────────

update public.beta_allowlist
set kyn_subscription_id = 'sub_1U2DssBoIAQos8mdZDG2GZR5'
where email = 'panteralandscapes@gmail.com';

update public.beta_allowlist
set kyn_subscription_id = 'sub_1UAzlKBoIAQos8mdOkyWJXRI'
where email = 'bernal.jovanne@gmail.com';

-- KYN sold offline: no Stripe subscription, so no cancellation event will
-- ever arrive. The paid-through date from KYN's own subscriptions row is the
-- entire lapse mechanism here, and resolve_plan checks it on every read.
insert into public.beta_allowlist
  (email, note, grant_tier, grant_source, kyn_expires_at)
values
  ('info@kamayelandscapeanddesign.com',
   'KYN subscriber since 2026-07-26, sold offline (no Stripe subscription). Comped BidClaw Pro until the KYN term ends.',
   'pro', 'kyn', '2027-07-26 21:59:08.225+00')
on conflict (email) do update
  set note           = excluded.note,
      grant_tier     = excluded.grant_tier,
      grant_source   = excluded.grant_source,
      kyn_expires_at = excluded.kyn_expires_at;

-- ────────────────────────────────────────────────────────────────────
-- Lock the new functions down
-- ────────────────────────────────────────────────────────────────────
--
-- Postgres grants EXECUTE to PUBLIC on every newly created function, and
-- Supabase exposes public-schema functions as PostgREST RPC endpoints. So
-- each of these was reachable from a browser holding only the anon key:
--
--   revoke_kyn_comp(text)  — DESTRUCTIVE. Any visitor who knew or guessed a
--                            KYN subscription id could strip that
--                            contractor's comp.
--   sync_plan(uuid)        — a write, callable for any account.
--   resolve_plan(uuid)     — discloses any account's tier by user id.
--   has_active_subscription(uuid) — the same disclosure as a boolean.
--                            Predates this branch (0030); same class of
--                            problem, so it closes at the same time.
--
-- Nothing legitimate loses access. The only RPC the frontend makes is
-- is_email_allowed(); the browser reads its own tier through my_plan(),
-- which takes no argument and resolves auth.uid(). The database's own
-- callers are unaffected because enforce_estimate_limit and
-- enforce_send_gate are SECURITY DEFINER functions owned by the superuser,
-- so their call to has_active_subscription() runs with the definer's
-- rights. The edge functions reach revoke_kyn_comp and sync_plan as
-- service_role, which bypasses grants entirely.
revoke all on function public.revoke_kyn_comp(text)         from public, anon, authenticated;
revoke all on function public.sync_plan(uuid)               from public, anon, authenticated;
revoke all on function public.resolve_plan(uuid)            from public, anon, authenticated;
revoke all on function public.has_active_subscription(uuid) from public, anon, authenticated;
