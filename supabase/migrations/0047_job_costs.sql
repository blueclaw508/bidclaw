-- 0047 — actual costs, pulled back from QuickBooks.
--
-- Roadmap step 5, and the reason the whole chain exists. The contractor
-- already codes bills, checks and card charges to a customer or job in
-- QuickBooks. Pull those lines in, land them on the BidClaw project, and
-- the Know Your Numbers loop closes: what it was bid at, what it cost,
-- where the gap was — by category, next to the estimate that priced it.
--
-- One row per QuickBooks expense line: Purchase (cash, check, card),
-- Bill, and JournalEntry lines that carry a customer. The QuickBooks
-- transaction and line ids make the pull idempotent; re-pulling a range
-- updates rather than duplicates, and a line deleted over there is
-- removed here on the next pull of its range.
--
-- Landing on a project: the line's CustomerRef is matched to a BidClaw
-- customer by remembered id (customers.qbo_customer_id); a customer with
-- exactly one live project lands there; a sub-customer ("job") whose name
-- matches a project name lands on that project; anything else is kept
-- with project_id null and shown for a person to assign. An assignment
-- made by hand is remembered and never overwritten by a later pull.
--
-- Category is a best effort from the account name, overridable per row.
-- What the contractor sees is the account name and the vendor, so a
-- wrong guess is visible and one click to fix.

create table public.job_costs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  customer_id      uuid references public.customers(id) on delete set null,
  -- Set once a person assigns the project; a later pull keeps it.
  project_pinned   boolean not null default false,
  qbo_txn_type     text not null check (qbo_txn_type in ('Purchase', 'Bill', 'JournalEntry')),
  qbo_txn_id       text not null,
  qbo_line_id      text not null,
  qbo_customer_ref text,
  txn_date         date not null,
  vendor_name      text,
  account_id       text,
  account_name     text,
  category         text not null default 'other'
                   check (category in ('labor', 'material', 'equipment', 'subcontractor', 'other')),
  category_pinned  boolean not null default false,
  description      text,
  amount           numeric(12,2) not null default 0,
  pulled_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, qbo_txn_type, qbo_txn_id, qbo_line_id)
);

create index job_costs_project_idx on public.job_costs (project_id, txn_date);
create index job_costs_user_date_idx on public.job_costs (user_id, txn_date desc);
create index job_costs_unassigned_idx on public.job_costs (user_id) where project_id is null;

comment on table public.job_costs is
  'Expense lines pulled from QuickBooks, landed on projects. Idempotent by transaction and line id.';

alter table public.job_costs enable row level security;
-- The owner reads, and may assign a project or correct a category. Rows
-- are written by the pull (service role); the API cannot insert them.
create policy job_costs_owner_select on public.job_costs
  for select using (user_id = auth.uid());
create policy job_costs_owner_update on public.job_costs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger job_costs_set_updated_at
  before update on public.job_costs
  for each row execute function public.tg_set_updated_at();

-- A hand assignment pins itself; a hand category correction pins itself.
create or replace function public.tg_job_cost_pin()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bidclaw.job_cost_pull', true), '') = 'on' then
    return new;
  end if;
  if new.project_id is distinct from old.project_id then new.project_pinned := true; end if;
  if new.category is distinct from old.category then new.category_pinned := true; end if;
  return new;
end
$$;

create trigger job_costs_pin
  before update on public.job_costs
  for each row execute function public.tg_job_cost_pin();

-- Remember which months have been pulled, so the page can say so.
alter table public.qbo_connections
  add column if not exists costs_pulled_from date,
  add column if not exists costs_pulled_to   date,
  add column if not exists costs_pulled_at   timestamptz;
