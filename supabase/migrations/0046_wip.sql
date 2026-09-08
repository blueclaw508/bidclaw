-- 0046 — WIP: percent-complete revenue by work area.
--
-- Roadmap step 4. A contractor's books record revenue when an invoice
-- is written; a CPA wants it recognised as the work is EARNED. The gap
-- between the two, per job, is the over/under billing that the WIP
-- schedule reports and the month-end journal entry books.
--
--   earned        = (contract value + approved change orders) × % complete
--   billed        = invoice lines dated on or before period end
--   over (under)  = billed − earned
--
-- BY WORK AREA, because that is where BidClaw has the numbers: the
-- approved proposal froze a price per work area (proposal_work_areas
-- subtotals, which are selling price), and every invoice line has been
-- allocated to a work area since 0044. Percent complete is the one input
-- a person supplies, per work area, per period; it carries forward from
-- the previous period so month-end is an update, not a rebuild.
--
-- A period is a month end. wip_snapshot() builds the rows for a period
-- from live data (contract, change orders, billings) and preserves the
-- entered percents; the page calls it on open and on refresh. Closing a
-- period freezes the rows and posts the journal entry; the reversal is
-- dated the next day so the following month starts clean.
--
-- Accounts for the entry come from qbo_account_mappings: 'revenue'
-- (income), 'wip_asset' (costs and estimated earnings in excess of
-- billings), 'wip_liability' (billings in excess of costs and estimated
-- earnings). The 0001 'wip_offset' slot is kept for compatibility and
-- unused.

-- ── Mapping slots ────────────────────────────────────────────────────

alter table public.qbo_account_mappings
  drop constraint if exists qbo_account_mappings_item_category_check;
alter table public.qbo_account_mappings
  add constraint qbo_account_mappings_item_category_check
  check (item_category in (
    'labor', 'material', 'equipment', 'disposal', 'design', 'other',
    'wip_offset', 'billing', 'revenue', 'wip_asset', 'wip_liability'
  ));

-- ── Periods ──────────────────────────────────────────────────────────

create table public.wip_periods (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  period_end       date not null,
  status           text not null default 'open' check (status in ('open', 'closed')),
  closed_at        timestamptz,
  notes            text,
  qbo_journal_id   text,
  qbo_reversal_id  text,
  qbo_posted_at    timestamptz,
  qbo_sync_error   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, period_end)
);

alter table public.wip_periods enable row level security;
create policy wip_periods_owner on public.wip_periods
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger wip_periods_set_updated_at
  before update on public.wip_periods
  for each row execute function public.tg_set_updated_at();

-- ── Entries ──────────────────────────────────────────────────────────

create table public.wip_entries (
  id                     uuid primary key default gen_random_uuid(),
  period_id              uuid not null references public.wip_periods(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,
  proposal_id            uuid references public.proposals(id) on delete cascade,
  -- Exactly one of these: a work area of the approved proposal, or an
  -- approved change order (which has no work area of its own).
  proposal_work_area_id  uuid references public.proposal_work_areas(id) on delete cascade,
  change_order_id        uuid references public.change_orders(id) on delete cascade,
  label                  text not null,
  contract_value         numeric(12,2) not null default 0,
  percent_complete       numeric(5,2) not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  billed_to_date         numeric(12,2) not null default 0,
  earned                 numeric(12,2) generated always as (round(contract_value * percent_complete / 100, 2)) stored,
  over_under             numeric(12,2) generated always as (round(billed_to_date - round(contract_value * percent_complete / 100, 2), 2)) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint wip_entries_one_subject check (
    (proposal_work_area_id is not null)::int + (change_order_id is not null)::int = 1
  )
);

create unique index wip_entries_period_wa_idx on public.wip_entries (period_id, proposal_work_area_id) where proposal_work_area_id is not null;
create unique index wip_entries_period_co_idx on public.wip_entries (period_id, change_order_id) where change_order_id is not null;
create index wip_entries_period_project_idx on public.wip_entries (period_id, project_id);

alter table public.wip_entries enable row level security;
create policy wip_entries_owner on public.wip_entries
  for all using (
    exists (select 1 from public.wip_periods p where p.id = wip_entries.period_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.wip_periods p where p.id = wip_entries.period_id and p.user_id = auth.uid())
  );
create trigger wip_entries_set_updated_at
  before update on public.wip_entries
  for each row execute function public.tg_set_updated_at();

-- A closed period is frozen: only the QuickBooks columns on the period
-- may still move (the post can happen after the close).
create or replace function public.tg_wip_entry_frozen()
returns trigger
language plpgsql
as $$
declare v_status text;
begin
  select status into v_status from public.wip_periods where id = coalesce(new.period_id, old.period_id);
  if v_status = 'closed' and coalesce(current_setting('bidclaw.wip_snapshot', true), '') <> 'on' then
    raise exception 'wip_period_closed' using errcode = 'P0001', hint = 'This month is closed. Reopen it to change a percent.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger wip_entries_frozen
  before insert or update or delete on public.wip_entries
  for each row execute function public.tg_wip_entry_frozen();

-- ── Snapshot ─────────────────────────────────────────────────────────
-- Build (or refresh) the entries for one of my periods from live data.
-- Contract value and billings are recomputed; percent complete is kept
-- where an entry already exists and otherwise carried from the most
-- recent earlier period, else 0. Rows for work areas no longer in play
-- (proposal lost, change order declined) are removed. Returns the
-- period id.

create or replace function public.wip_snapshot(p_period_end date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_period uuid;
  v_status text;
begin
  if v_user is null then raise exception 'not_signed_in' using errcode = '28000'; end if;

  insert into public.wip_periods (user_id, period_end)
  values (v_user, p_period_end)
  on conflict (user_id, period_end) do update set updated_at = now()
  returning id, status into v_period, v_status;

  if v_status = 'closed' then
    return v_period;  -- frozen; nothing to rebuild
  end if;

  perform set_config('bidclaw.wip_snapshot', 'on', true);

  -- A. Work areas of approved-or-beyond proposals on my projects.
  with subjects as (
    select p.id as project_id, pr.id as proposal_id, pwa.id as pwa_id,
           coalesce(nullif(btrim(pwa.name_override), ''), wa.name, 'Work area') as label,
           round(coalesce(pwa.labor_subtotal,0) + coalesce(pwa.material_subtotal,0) + coalesce(pwa.equipment_subtotal,0)
                 + coalesce(pwa.subcontractor_subtotal,0) + coalesce(pwa.other_subtotal,0), 2) as contract_value
    from public.projects p
    join public.proposals pr on pr.project_id = p.id
    join public.proposal_work_areas pwa on pwa.proposal_id = pr.id and pwa.enabled
    left join public.work_areas wa on wa.id = pwa.work_area_id
    where p.user_id = v_user
      and pr.status in ('approved', 'in_progress', 'completed')
      and coalesce(pr.approved_at, pr.updated_at) <= (p_period_end + 1)::timestamptz
  ),
  billed as (
    select il.proposal_work_area_id as pwa_id, sum(il.amount) as amt
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
    where i.user_id = v_user
      and i.status in ('sent', 'paid')
      and i.issue_date <= p_period_end
      and il.proposal_work_area_id is not null
    group by il.proposal_work_area_id
  ),
  prior as (
    -- Most recent earlier period's percent for the same work area.
    select distinct on (e.proposal_work_area_id) e.proposal_work_area_id, e.percent_complete
    from public.wip_entries e
    join public.wip_periods wp on wp.id = e.period_id
    where wp.user_id = v_user and wp.period_end < p_period_end and e.proposal_work_area_id is not null
    order by e.proposal_work_area_id, wp.period_end desc
  )
  insert into public.wip_entries
    (period_id, project_id, proposal_id, proposal_work_area_id, label, contract_value, percent_complete, billed_to_date)
  select v_period, s.project_id, s.proposal_id, s.pwa_id, s.label, s.contract_value,
         coalesce(pr.percent_complete, 0), coalesce(b.amt, 0)
  from subjects s
  left join billed b on b.pwa_id = s.pwa_id
  left join prior pr on pr.proposal_work_area_id = s.pwa_id
  on conflict (period_id, proposal_work_area_id) where proposal_work_area_id is not null do update
    set label = excluded.label,
        contract_value = excluded.contract_value,
        billed_to_date = excluded.billed_to_date,
        project_id = excluded.project_id,
        proposal_id = excluded.proposal_id;

  -- B. Approved change orders, each its own line.
  with subjects as (
    select co.project_id, co.proposal_id, co.id as co_id,
           'Change order #' || co.change_number || ': ' || co.title as label,
           co.amount as contract_value
    from public.change_orders co
    where co.user_id = v_user and co.status = 'approved'
      and coalesce(co.approved_at, co.updated_at) <= (p_period_end + 1)::timestamptz
  ),
  billed as (
    select il.change_order_id as co_id, sum(il.amount) as amt
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
    where i.user_id = v_user and i.status in ('sent', 'paid') and i.issue_date <= p_period_end
      and il.change_order_id is not null
    group by il.change_order_id
  ),
  prior as (
    select distinct on (e.change_order_id) e.change_order_id, e.percent_complete
    from public.wip_entries e
    join public.wip_periods wp on wp.id = e.period_id
    where wp.user_id = v_user and wp.period_end < p_period_end and e.change_order_id is not null
    order by e.change_order_id, wp.period_end desc
  )
  insert into public.wip_entries
    (period_id, project_id, proposal_id, change_order_id, label, contract_value, percent_complete, billed_to_date)
  select v_period, s.project_id, s.proposal_id, s.co_id, s.label, s.contract_value,
         coalesce(pr.percent_complete, 0), coalesce(b.amt, 0)
  from subjects s
  left join billed b on b.co_id = s.co_id
  left join prior pr on pr.change_order_id = s.co_id
  on conflict (period_id, change_order_id) where change_order_id is not null do update
    set label = excluded.label,
        contract_value = excluded.contract_value,
        billed_to_date = excluded.billed_to_date,
        project_id = excluded.project_id,
        proposal_id = excluded.proposal_id;

  -- Drop rows whose subject is no longer in play.
  delete from public.wip_entries e
  where e.period_id = v_period
    and (
      (e.proposal_work_area_id is not null and not exists (
        select 1 from public.proposal_work_areas pwa
        join public.proposals pr on pr.id = pwa.proposal_id
        where pwa.id = e.proposal_work_area_id and pwa.enabled
          and pr.status in ('approved', 'in_progress', 'completed')))
      or
      (e.change_order_id is not null and not exists (
        select 1 from public.change_orders co where co.id = e.change_order_id and co.status = 'approved'))
    );

  perform set_config('bidclaw.wip_snapshot', '', true);
  return v_period;
end
$$;

revoke all on function public.wip_snapshot(date) from public, anon;
grant execute on function public.wip_snapshot(date) to authenticated;

comment on function public.wip_snapshot(date) is
  'Build or refresh my WIP entries for a month end from live contract, change order and billing data, keeping entered percents.';
