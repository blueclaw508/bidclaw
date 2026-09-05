-- 0035 — an invite can carry a tier.
--
-- THE GAP THIS CLOSES. 0033 built the KYN comp machinery — kyn_granted_tier,
-- plan_source, resolve_plan() — and every piece of it reads company_settings,
-- a row that does not exist until the person signs up. So there was nowhere
-- to record "this contractor has KYN and is owed BidClaw Pro" for someone who
-- has not created a BidClaw account yet. Which is all of them.
--
-- That is the whole population we care about: the KYN subscribers are real
-- paying customers of a different product who have never touched BidClaw.
-- The grant has to survive from the moment we decide it until whenever they
-- first log in, which may be weeks later or never.
--
-- WHERE IT LIVES. beta_allowlist (0034) is already the record of who may
-- join, so it becomes the record of what they arrive holding. One row, one
-- place to look, and no second table that can disagree with the first about
-- whether someone exists.
--
-- WHAT IT IS NOT. This does not make anyone a paying BidClaw customer.
-- paid_tier stays null — that column belongs to the Stripe webhook and
-- nothing else. resolve_plan()'s precedence already handles the collision
-- correctly: if a comped contractor later buys Pro + AI, paid_tier wins and
-- the comp sits underneath as the floor they fall back to, not a downgrade.

-- ────────────────────────────────────────────────────────────────────
-- The grant, attached to the invite
-- ────────────────────────────────────────────────────────────────────

alter table public.beta_allowlist
  add column if not exists grant_tier text,
  add column if not exists grant_source text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'beta_allowlist_grant_tier_valid') then
    alter table public.beta_allowlist
      add constraint beta_allowlist_grant_tier_valid
      check (grant_tier is null or grant_tier in ('pro', 'pro_ai'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'beta_allowlist_grant_source_valid') then
    alter table public.beta_allowlist
      add constraint beta_allowlist_grant_source_valid
      -- 'kyn'    — comped because they subscribe to Know Your Numbers.
      --            Revocable: if KYN lapses, so does this.
      -- 'manual' — granted by hand for a reason in `note`. Not revocable
      --            by any automatic process, which is exactly why it is a
      --            different value and not a flavour of 'kyn'.
      check (grant_source is null or grant_source in ('kyn', 'manual'));
  end if;

  -- A tier with no stated source is an entitlement nobody can later audit
  -- or revoke, so refuse the half-filled version outright.
  if not exists (select 1 from pg_constraint
                 where conname = 'beta_allowlist_grant_complete') then
    alter table public.beta_allowlist
      add constraint beta_allowlist_grant_complete
      check ((grant_tier is null) = (grant_source is null));
  end if;
end;
$$;

comment on column public.beta_allowlist.grant_tier is
  'Tier this person lands on at signup. NULL = they arrive on the free trial.';
comment on column public.beta_allowlist.grant_source is
  'Why: kyn (comped via Know Your Numbers, revocable if KYN lapses) or manual.';

-- ────────────────────────────────────────────────────────────────────
-- Apply it when the account is created
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
begin
  -- Legacy profiles.subscription_tier. Nothing in the app reads it any
  -- more — company_settings.plan is what the gates consult — but it is
  -- NOT NULL, so it still has to be written.
  v_tier := case
    when new.email = 'ianm@blueclawassociates.com' then 'ai_pro'
    else 'free'
  end;

  insert into public.profiles (id, email, subscription_tier)
  values (new.id, new.email, v_tier);

  insert into public.company_settings (user_id) values (new.id);

  -- Did we promise this address a tier before it had an account?
  select a.grant_tier, a.grant_source
    into v_grant_tier, v_grant_source
  from public.beta_allowlist a
  where a.email = lower(trim(new.email));

  if v_grant_tier is not null then
    update public.company_settings
    set
      -- `plan` is what has_active_subscription(), the create gate, the send
      -- gate and the Jamie tier lookup all read TODAY. resolve_plan() is
      -- the future single source of truth and still has no callers, so
      -- writing only the kyn_ columns would grant precisely nothing.
      plan = v_grant_tier,
      -- ...and the columns resolve_plan() will read once it is wired, so
      -- the two can never disagree about why this account is entitled.
      kyn_granted_tier = case when v_grant_source = 'kyn'
                              then v_grant_tier else null end,
      kyn_checked_at   = case when v_grant_source = 'kyn'
                              then now() else null end,
      plan_source      = v_grant_source,
      -- Only the AI tier turns Jamie on. A comped Pro contractor gets the
      -- locked "Build with Jamie" button and the upgrade path, which is
      -- the entire point of comping them.
      jamie_enabled    = (v_grant_tier = 'pro_ai')
      -- paid_tier deliberately untouched: they have paid BidClaw nothing.
      -- That column is the Stripe webhook's alone.
    where user_id = new.id;
  end if;

  -- Five labor slots and ten equipment slots, BLANK. Every contractor
  -- builds their own numbers; nothing of Blue Claw's is seeded into
  -- anyone's account, ever.
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
-- The two KYN subscribers, comped to BidClaw Pro
-- ────────────────────────────────────────────────────────────────────
--
-- Both pay for Know Your Numbers through Stripe. Ian's rule: KYN carries a
-- free BidClaw Pro, and if the KYN subscription lapses the BidClaw access
-- goes with it. Recording the KYN sub id in the note so the eventual lapse
-- check has something to match on.
--
-- Pro, not Pro + AI, deliberately. They land holding the locked "Build with
-- Jamie" button and a working upgrade path — which is the point of comping
-- them in the first place.
--
-- NOT included here: ian@blueclawgroup.com (a comp on Ian's own account)
-- and info@kamayelandscapeanddesign.com (KYN sold offline, not via Stripe).
-- Neither is a Stripe-billed KYN subscriber; add them the same way if that
-- is the intent.
insert into public.beta_allowlist (email, note, grant_tier, grant_source) values
  ('panteralandscapes@gmail.com',
   'KYN subscriber since 2026-08-08 (Stripe sub_1U2DssBoIAQos8mdZDG2GZR5). Comped BidClaw Pro.',
   'pro', 'kyn'),
  ('bernal.jovanne@gmail.com',
   'KYN subscriber since 2026-09-01 (Stripe sub_1UAzlKBoIAQos8mdOkyWJXRI). Comped BidClaw Pro.',
   'pro', 'kyn')
on conflict (email) do update
  set note         = excluded.note,
      grant_tier   = excluded.grant_tier,
      grant_source = excluded.grant_source;
