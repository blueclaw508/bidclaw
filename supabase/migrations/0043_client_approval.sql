-- 0043 — a client can approve a proposal from a link.
--
-- Until now "Sent" was a status the contractor flipped after emailing a
-- PDF, and "Approved" was the contractor's word for it. Nothing in the
-- system heard from the client. This is the first link in the accounting
-- chain (approval → deposit invoice → QuickBooks → WIP), and it is also
-- the feature the Pro pricing card has been promising as "Client
-- approvals + e-sign".
--
-- Two tables. proposal_shares holds one link per proposal: a random token
-- the contractor hands to the client, with an expiry and a revoke switch.
-- proposal_signatures is the record of what the client did with it:
-- accepted with a typed name and a drawn signature, or declined with a
-- reason. A proposal can carry several signature rows over its life (a
-- decline, then a revised proposal accepted); the latest one is the
-- answer.
--
-- Nobody writes these tables through the API. The contractor creates and
-- revokes links through two functions below, scoped to auth.uid(). The
-- client reads and signs through the proposal-share edge function, which
-- holds the service key and validates the token itself — the anon role
-- gets no policy on either table, so a stranger with the API URL and the
-- publishable key sees nothing.
--
-- A link is a send. create_proposal_share moves a draft to Sent on the
-- way out, which means enforce_send_gate (0030/0042) rules on it exactly
-- as the status menu would: a free account and a trial-built proposal
-- cannot be shared, for the same reasons they cannot be marked Sent.
--
-- approved_at joins proposals so the deposit invoice (roadmap step 2) has
-- a date to key off. A trigger stamps it on the first transition into
-- Approved whoever made the change, so a proposal the contractor approves
-- by hand carries one too.

-- ── approved_at ─────────────────────────────────────────────────────

alter table public.proposals
  add column if not exists approved_at timestamptz;

comment on column public.proposals.approved_at is
  'First time this proposal reached Approved — by client signature or by hand. Never cleared.';

create or replace function public.tg_stamp_proposal_approved()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists proposals_stamp_approved on public.proposals;
create trigger proposals_stamp_approved
  before update on public.proposals
  for each row execute function public.tg_stamp_proposal_approved();

-- ── proposal_shares ─────────────────────────────────────────────────

create table public.proposal_shares (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null unique references public.proposals(id) on delete cascade,
  token          text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '90 days',
  revoked_at     timestamptz,
  view_count     integer not null default 0,
  last_viewed_at timestamptz
);

comment on table public.proposal_shares is
  'One client link per proposal. Regenerating replaces the token; revoking keeps the row and closes the link.';

alter table public.proposal_shares enable row level security;

-- The owner can see their links (to show the URL, view count, state).
-- No insert/update/delete policy: writes go through the functions below.
create policy proposal_shares_owner_select on public.proposal_shares
  for select using (
    exists (
      select 1
      from public.proposals pr
      join public.projects p on p.id = pr.project_id
      where pr.id = proposal_shares.proposal_id
        and p.user_id = auth.uid()
    )
  );

-- ── proposal_signatures ─────────────────────────────────────────────

create table public.proposal_signatures (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references public.proposals(id) on delete cascade,
  share_id       uuid references public.proposal_shares(id) on delete set null,
  decision       text not null check (decision in ('accepted', 'declined')),
  signer_name    text not null,
  signer_email   text,
  -- PNG data URL of the drawn signature. Required on accept, absent on decline.
  signature_data text,
  decline_reason text,
  ip_address     text,
  user_agent     text,
  signed_at      timestamptz not null default now(),
  constraint proposal_signatures_accepted_has_signature
    check (decision <> 'accepted' or signature_data is not null)
);

create index proposal_signatures_proposal_idx
  on public.proposal_signatures (proposal_id, signed_at desc);

comment on table public.proposal_signatures is
  'What the client did with a shared proposal. Latest row per proposal is the current answer.';

alter table public.proposal_signatures enable row level security;

create policy proposal_signatures_owner_select on public.proposal_signatures
  for select using (
    exists (
      select 1
      from public.proposals pr
      join public.projects p on p.id = pr.project_id
      where pr.id = proposal_signatures.proposal_id
        and p.user_id = auth.uid()
    )
  );

-- ── create / revoke, owner only ─────────────────────────────────────

create or replace function public.create_proposal_share(p_proposal_id uuid)
returns public.proposal_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_status text;
  v_token  text;
  v_row    public.proposal_shares;
begin
  select p.user_id, pr.status
    into v_owner, v_status
  from public.proposals pr
  join public.projects p on p.id = pr.project_id
  where pr.id = p_proposal_id;

  -- Not yours reads as not there, the same as RLS would say.
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'proposal_not_found' using errcode = 'P0002';
  end if;

  -- A link is a send. The send gate fires on this update and its error
  -- propagates to the caller unchanged, so the browser can show the
  -- same upgrade path it shows for the status menu.
  if v_status in ('draft', 'ready_to_send') then
    update public.proposals set status = 'sent' where id = p_proposal_id;
  elsif v_status not in ('sent', 'approved', 'in_progress', 'completed') then
    raise exception 'proposal_not_shareable'
      using errcode = 'P0001',
            hint = 'A lost proposal cannot be shared. Move it back to Draft first.';
  end if;

  -- Two v4 UUIDs side by side: 244 random bits, hex, no extension needed.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.proposal_shares (proposal_id, token)
  values (p_proposal_id, v_token)
  on conflict (proposal_id) do update
    set token      = excluded.token,
        created_at = now(),
        expires_at = now() + interval '90 days',
        revoked_at = null
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.create_proposal_share(uuid) from public;
grant execute on function public.create_proposal_share(uuid) to authenticated;

comment on function public.create_proposal_share(uuid) is
  'Create or regenerate the client link for one of my proposals. Moves a draft to Sent (send gate applies).';

create or replace function public.revoke_proposal_share(p_proposal_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.proposal_shares s
     set revoked_at = now()
    from public.proposals pr
    join public.projects p on p.id = pr.project_id
   where s.proposal_id = p_proposal_id
     and pr.id = s.proposal_id
     and p.user_id = auth.uid()
     and s.revoked_at is null;
$$;

revoke all on function public.revoke_proposal_share(uuid) from public;
grant execute on function public.revoke_proposal_share(uuid) to authenticated;

comment on function public.revoke_proposal_share(uuid) is
  'Close the client link on one of my proposals. The row stays so the view count survives.';

-- ── anon ────────────────────────────────────────────────────────────
-- `revoke all from public` is not enough on Supabase: the schema's
-- default privileges grant EXECUTE to anon by name, and a role's own
-- grant survives PUBLIC losing its own. Same lesson as 0022, 0036, 0041.
-- A stranger holding the publishable key must not be able to mint or
-- close a link for a proposal id they guessed — the functions check
-- auth.uid() and would refuse, but the door should not open at all.
revoke execute on function public.create_proposal_share(uuid) from anon;
revoke execute on function public.revoke_proposal_share(uuid) from anon;
