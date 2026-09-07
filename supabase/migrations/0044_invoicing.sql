-- 0044 — invoicing from the payment schedule.
--
-- Roadmap step 2. A proposal has carried a payment schedule since 0029
-- ("50% deposit upon acceptance, balance upon completion") and, since
-- 0043, an approved_at date the client set by signing. Nothing turned
-- either into a bill. This does.
--
-- An invoice is a milestone applied to the approved proposal, plus any
-- change orders, as LINES ALLOCATED TO WORK AREAS: a 50% deposit on a
-- three-work-area proposal is three lines, each half of its area's
-- price. That allocation is not decoration — the WIP schedule (step 4)
-- needs billings BY WORK AREA to compute over/under billings, and the
-- only cheap moment to capture that is when the invoice is written.
--
-- Money is numeric(12,2) and every total is MAINTAINED BY TRIGGER from
-- its parts: invoices.subtotal from its lines, invoices.amount_paid from
-- its payments. A total that is a stored sum of the rows on screen is
-- one a bookkeeper can reconcile; a total the browser computed is not.
--
-- Numbering is per company and gapless-enough: a counter row per user,
-- bumped under a row lock inside the insert trigger. The number is an
-- integer; the prefix ("INV-") is a company setting applied at display
-- time, so changing it later renumbers nothing.
--
-- No tax in v1. Massachusetts does not tax landscape and masonry labor,
-- and materials tax is paid at purchase and priced in; a contractor who
-- needs to bill tax adds a line for it. A tax column arrives with the
-- QuickBooks step, which is where the tax code would come from anyway.
--
-- Change orders become first-class here too, minimally: a numbered,
-- approvable record with an amount, so an invoice can carry it as a line
-- and step 4 can tell contract value from original scope.
--
-- Invoicing is a paid feature, gated like sending: a free account cannot
-- create an invoice. The error name follows the send gate's so the
-- browser routes it to the same upgrade modal.

-- ── Company defaults ─────────────────────────────────────────────────

alter table public.company_settings
  add column if not exists invoice_prefix      text    not null default 'INV-',
  add column if not exists invoice_due_days    integer not null default 15,
  add column if not exists invoice_footer_text text;

comment on column public.company_settings.invoice_prefix is
  'Shown before the invoice number: INV-, BCA-, anything. Display only; the stored number is an integer.';
comment on column public.company_settings.invoice_due_days is
  'Default terms: due_date = issue_date + this many days when an invoice is created without one.';

-- ── Numbering ────────────────────────────────────────────────────────

create table public.invoice_counters (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  last_number integer not null default 0
);

alter table public.invoice_counters enable row level security;
-- No policies on purpose: only the trigger below (SECURITY DEFINER) touches it.

create or replace function public.next_invoice_number(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.invoice_counters (user_id, last_number)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set last_number = public.invoice_counters.last_number + 1
  returning last_number;
$$;

revoke all on function public.next_invoice_number(uuid) from public, anon, authenticated;

-- ── Change orders ────────────────────────────────────────────────────

create table public.change_orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  proposal_id   uuid references public.proposals(id) on delete set null,
  change_number integer not null,
  title         text not null,
  description   text,
  amount        numeric(12,2) not null default 0,
  status        text not null default 'draft'
                check (status in ('draft', 'approved', 'declined')),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, change_number)
);

create index change_orders_project_idx on public.change_orders (project_id);

alter table public.change_orders enable row level security;
create policy change_orders_owner on public.change_orders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger change_orders_set_updated_at
  before update on public.change_orders
  for each row execute function public.tg_set_updated_at();

-- Number per project on insert; stamp approved_at on the first approval.
create or replace function public.tg_change_order_before()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.change_number is null then
      select coalesce(max(change_number), 0) + 1
        into new.change_number
      from public.change_orders
      where project_id = new.project_id;
    end if;
  end if;
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end
$$;

create trigger change_orders_before
  before insert or update on public.change_orders
  for each row execute function public.tg_change_order_before();

-- ── Invoices ─────────────────────────────────────────────────────────

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  proposal_id       uuid references public.proposals(id) on delete set null,
  invoice_number    integer not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date        date not null default current_date,
  due_date          date,
  -- Which milestone this bills, when it came from the schedule.
  milestone_label   text,
  milestone_percent numeric(6,2),
  notes             text,
  terms             text,
  -- Maintained by triggers. Never written by the API.
  subtotal          numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  amount_paid       numeric(12,2) not null default 0,
  sent_at           timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, invoice_number)
);

create index invoices_project_idx  on public.invoices (project_id, issue_date desc);
create index invoices_proposal_idx on public.invoices (proposal_id);

comment on table public.invoices is
  'A bill to the client: a milestone of an approved proposal, a change order, or a custom amount. Totals are trigger-maintained.';

alter table public.invoices enable row level security;
create policy invoices_owner on public.invoices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.tg_set_updated_at();

-- Gate, number, default due date — one BEFORE INSERT trigger.
create or replace function public.tg_invoice_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_days integer;
begin
  -- The owner is the project's owner, whatever the caller sent.
  select p.user_id into new.user_id
  from public.projects p where p.id = new.project_id;
  if new.user_id is null then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if not public.has_active_subscription(new.user_id) then
    raise exception 'subscription_required_to_invoice'
      using errcode = 'P0001',
            hint = 'Subscribe to send invoices. Your proposals and estimates are untouched.';
  end if;

  new.invoice_number := public.next_invoice_number(new.user_id);

  if new.due_date is null then
    select coalesce(cs.invoice_due_days, 15) into v_due_days
    from public.company_settings cs where cs.user_id = new.user_id;
    new.due_date := new.issue_date + coalesce(v_due_days, 15);
  end if;

  return new;
end
$$;

create trigger invoices_before_insert
  before insert on public.invoices
  for each row execute function public.tg_invoice_before_insert();

-- Status timestamps, and the totals are not the API's to write.
create or replace function public.tg_invoice_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sent'   and old.status is distinct from 'sent'   and new.sent_at   is null then new.sent_at   := now(); end if;
  if new.status = 'paid'   and old.status is distinct from 'paid'   and new.paid_at   is null then new.paid_at   := now(); end if;
  if new.status = 'void'   and old.status is distinct from 'void'   and new.voided_at is null then new.voided_at := now(); end if;
  -- Only the line and payment triggers move these (they set a flag).
  if coalesce(current_setting('bidclaw.invoice_totals', true), '') <> 'trigger' then
    new.subtotal    := old.subtotal;
    new.total       := old.total;
    new.amount_paid := old.amount_paid;
  end if;
  return new;
end
$$;

create trigger invoices_before_update
  before update on public.invoices
  for each row execute function public.tg_invoice_before_update();

-- ── Invoice lines ────────────────────────────────────────────────────

create table public.invoice_lines (
  id                      uuid primary key default gen_random_uuid(),
  invoice_id              uuid not null references public.invoices(id) on delete cascade,
  -- Where this money lands for WIP. Null for a custom line.
  proposal_work_area_id   uuid references public.proposal_work_areas(id) on delete set null,
  change_order_id         uuid references public.change_orders(id) on delete set null,
  description             text not null,
  quantity                numeric(12,3) not null default 1,
  unit_price              numeric(12,2) not null default 0,
  amount                  numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);
create index invoice_lines_work_area_idx on public.invoice_lines (proposal_work_area_id);

alter table public.invoice_lines enable row level security;
create policy invoice_lines_owner on public.invoice_lines
  for all using (
    exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.user_id = auth.uid())
  );

create trigger invoice_lines_set_updated_at
  before update on public.invoice_lines
  for each row execute function public.tg_set_updated_at();

-- ── Payments ─────────────────────────────────────────────────────────

create table public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default 'check'
              check (method in ('check', 'cash', 'card', 'ach', 'other')),
  reference   text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id, paid_on);

alter table public.invoice_payments enable row level security;
create policy invoice_payments_owner on public.invoice_payments
  for all using (
    exists (select 1 from public.invoices i where i.id = invoice_payments.invoice_id and i.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.invoices i where i.id = invoice_payments.invoice_id and i.user_id = auth.uid())
  );

-- ── Totals, maintained ───────────────────────────────────────────────

create or replace function public.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(12,2);
  v_paid     numeric(12,2);
  v_status   text;
begin
  select coalesce(sum(amount), 0) into v_subtotal from public.invoice_lines    where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid     from public.invoice_payments where invoice_id = p_invoice_id;
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status is null then return; end if;

  perform set_config('bidclaw.invoice_totals', 'trigger', true);
  update public.invoices
     set subtotal    = v_subtotal,
         total       = v_subtotal,
         amount_paid = v_paid,
         -- Paid in full flips it to paid; a refund that reopens a balance
         -- flips it back to sent. Void and draft are left alone.
         status = case
           when v_status = 'void' then 'void'
           when v_status = 'draft' then 'draft'
           when v_paid >= v_subtotal and v_subtotal > 0 then 'paid'
           when v_status = 'paid' and v_paid < v_subtotal then 'sent'
           else v_status
         end,
         paid_at = case
           when v_status <> 'void' and v_paid >= v_subtotal and v_subtotal > 0
             then coalesce(paid_at, now())
           when v_paid < v_subtotal then null
           else paid_at
         end
   where id = p_invoice_id;
  perform set_config('bidclaw.invoice_totals', '', true);
end
$$;

revoke all on function public.recompute_invoice_totals(uuid) from public, anon, authenticated;

create or replace function public.tg_invoice_parts_changed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_invoice_totals(old.invoice_id);
  else
    perform public.recompute_invoice_totals(new.invoice_id);
    if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
      perform public.recompute_invoice_totals(old.invoice_id);
    end if;
  end if;
  return null;
end
$$;

create trigger invoice_lines_totals
  after insert or update or delete on public.invoice_lines
  for each row execute function public.tg_invoice_parts_changed();

create trigger invoice_payments_totals
  after insert or update or delete on public.invoice_payments
  for each row execute function public.tg_invoice_parts_changed();
