-- 0034 — the Phase 1 signup allowlist becomes a table.
--
-- Before this, one email address was hardcoded in two places that "must
-- match": this trigger, and src/lib/authAllowlist.ts. Inviting anyone meant
-- a migration AND a frontend deploy, which is a large part of why BidClaw
-- has had exactly one user since May.
--
-- Two things were wrong with the constant beyond the friction:
--
--  1. IT SHIPPED. authAllowlist.ts compiles into the public JS bundle, so
--     the address sat in plain text in dist/assets/index-*.js for anyone
--     who opened devtools — while that same file's comment insisted the
--     email "must NEVER be rendered in any user-facing UI — that would leak
--     which account has access to the system." It had already leaked, to
--     every visitor, for four months.
--
--  2. Two copies that must agree eventually don't.
--
-- After: one table, service-role only. RLS is on and NO policy is defined,
-- so the list cannot be read or written through PostgREST at all. The
-- frontend never receives it and therefore cannot ship it. Membership is
-- answered by a boolean RPC that takes one address and returns yes or no —
-- it cannot enumerate.
--
-- FAIL-CLOSED. An empty table denies every signup; a dropped table makes
-- the trigger raise and denies every signup. The failure mode of losing
-- this data is "nobody can join", never "anybody can".
--
-- To invite someone:  insert into public.beta_allowlist (email, note) ...
-- To revoke someone:  delete from public.beta_allowlist where email = ...
-- Revoking also ends any live session — see is_email_allowed() below.

-- ────────────────────────────────────────────────────────────────────
-- The list
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.beta_allowlist (
  email       text primary key,
  -- Who this is, in plain English. This table is the only record of why a
  -- given stranger can log into the product.
  note        text,
  invited_at  timestamptz not null default now(),

  -- Stored lowercase, always. Postgres compares text case-sensitively, so
  -- a capitalised invite would create a row the trigger's lower() lookup
  -- could never match — an invite that silently does nothing.
  constraint beta_allowlist_email_lower check (email = lower(email)),
  -- Cheap shape check. Not RFC 5322 validation; just enough that a typo
  -- like a bare username or a pasted name cannot become a row.
  constraint beta_allowlist_email_shape check (email like '%_@_%.__%')
);

alter table public.beta_allowlist enable row level security;

-- DELIBERATELY NO POLICIES.
--
-- A row in this table grants access to the product, so it is writable by
-- nobody through the API — not even by an authenticated user editing their
-- own row, because there is no "own row" here. It is equally unreadable,
-- which is the part that stops the list leaking the way the constant did.
-- Service role (the SQL editor, a migration, an edge function) bypasses RLS
-- and is the only way in.

-- Supabase grants ALL on every new table in `public` to anon and
-- authenticated by default. RLS with no policies already blocks the DML,
-- but leaving the grants in place was the wrong posture here:
--
--   1. TRUNCATE IS NOT SUBJECT TO RLS — it is governed by the grant alone,
--      so `anon` held a live path to emptying the allowlist. That fails
--      closed (nobody can then sign up) rather than open, but a drive-by
--      denial of signup is still a hole.
--
--   2. A table whose rows grant product access should not be one
--      `disable row level security` away from world-writable. With the
--      grants revoked it takes two independent mistakes, not one.
revoke all on table public.beta_allowlist from anon, authenticated;

comment on table public.beta_allowlist is
  'Phase 1 signup allowlist. Service-role only — no RLS policies by design. '
  'Insert a row to invite someone; delete it to revoke them.';

-- Carry over both existing entries, and add Ian's second identity so the
-- Stripe billing round trip can be run against an account that is NOT the
-- manually-granted founder account.
insert into public.beta_allowlist (email, note) values
  ('ianm@blueclawassociates.com',
   'Founder — Blue Claw Associates'),
  ('jamie-rls-probe@bidclaw.test',
   'Test-harness fixture (scripts/test-jamie-gate.ts). RFC-reserved .test TLD receives no mail, so no outsider can complete magic-link auth with it.'),
  ('ian@bostontenniscourt.com',
   'Founder second identity — subscription/billing round-trip testing')
on conflict (email) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- Layer 1: the signup gate (unchanged in spirit, table-driven in fact)
-- ────────────────────────────────────────────────────────────────────
--
-- BEFORE INSERT on auth.users. This is the real lock: it runs inside the
-- database on the row Supabase Auth is trying to create, so no browser,
-- no client library and no forged request can route around it. Everything
-- on the frontend is a courtesy message.

create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (
    select 1
    from public.beta_allowlist a
    where a.email = lower(trim(new.email))
  ) then
    -- Wording unchanged: it is already what the UI prints, and it names no
    -- address, so it tells a stranger nothing about who does have access.
    raise exception 'Signup not permitted for this email during Phase 1 lockdown'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- The trigger itself (created in 0001) still points at this function and is
-- left alone. Re-asserted here only so a fresh database built from these
-- migrations in order ends up with it.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'enforce_email_allowlist_trigger'
  ) then
    create trigger enforce_email_allowlist_trigger
      before insert on auth.users
      for each row execute function public.enforce_email_allowlist();
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────
-- Layer 2: a membership question the client may ask
-- ────────────────────────────────────────────────────────────────────
--
-- Returns yes/no for ONE address. It cannot list the table, so the client
-- can tell a visitor "you're not on the list" without ever learning who is.
--
-- On the enumeration question: this does let someone test addresses one at
-- a time. That oracle already existed — the signup error says the same
-- thing — and this replaces a bundle that published the list outright, so
-- it is strictly less disclosure than what shipped before.

create or replace function public.is_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.beta_allowlist
    where email = lower(trim(coalesce(p_email, '')))
  );
$function$;

revoke all on function public.is_email_allowed(text) from public;
grant execute on function public.is_email_allowed(text) to anon, authenticated;

comment on function public.is_email_allowed(text) is
  'True when this one address is on the Phase 1 allowlist. Cannot enumerate. '
  'Used by the sign-in form for a straight answer, and by AuthContext to end '
  'the session of someone who has since been revoked.';
