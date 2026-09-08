-- 0045 — QuickBooks Online connection.
--
-- Roadmap step 3. Each contractor connects THEIR OWN QuickBooks company
-- through Intuit's OAuth; BidClaw holds one refresh token per account and
-- pushes invoices and payments across as they are sent and received.
-- qbo_account_mappings has waited for this since 0001.
--
-- TOKENS. An access token lasts an hour; the refresh token that mints
-- them lasts 100 days and is the one secret that matters — it IS the
-- contractor's books. It is stored encrypted (AES-GCM, key in the edge
-- function secrets, never in the database), on a table with RLS enabled
-- and NO policies: only the service role, i.e. the edge functions, can
-- read it. The browser sees connection STATUS through a view that
-- carries no token column at all.
--
-- MAPPING. A QuickBooks invoice line needs an Item, not an account. One
-- service item — "Contract billing" or whatever the contractor calls it —
-- carries every progress-billing line, because a milestone line is a
-- slice of a whole work area, not a category of cost. The mapping row
-- 'billing' holds it. The per-category ACCOUNT mappings stay for the WIP
-- journal entry (step 4), which does post by account.
--
-- IDS. customers.qbo_customer_id, invoices.qbo_invoice_id and
-- invoice_payments.qbo_payment_id remember what was pushed so a second
-- push updates rather than duplicates. One QuickBooks company per
-- BidClaw account, so a bare id is enough.

-- ── The connection ──────────────────────────────────────────────────

create table public.qbo_connections (
  user_id                  uuid primary key references public.profiles(id) on delete cascade,
  realm_id                 text not null,
  company_name             text,
  environment              text not null check (environment in ('sandbox', 'production')),
  access_token_enc         text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_enc        text not null,
  refresh_token_expires_at timestamptz not null,
  connected_at             timestamptz not null default now(),
  last_sync_at             timestamptz,
  last_error               text,
  updated_at               timestamptz not null default now()
);

comment on table public.qbo_connections is
  'One QuickBooks Online company per account. Tokens are AES-GCM ciphertext; service role only.';

alter table public.qbo_connections enable row level security;
-- No policies. The edge functions hold the service key; the browser reads the view.

create trigger qbo_connections_set_updated_at
  before update on public.qbo_connections
  for each row execute function public.tg_set_updated_at();

-- What the browser may know: that a connection exists, to which company,
-- in which environment, and how the last sync went. No token, ever. A
-- SECURITY DEFINER function scoped to auth.uid() is the only read path.
create or replace function public.my_qbo_connection()
returns table (
  realm_id text,
  company_name text,
  environment text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  refresh_token_expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select realm_id, company_name, environment, connected_at, last_sync_at, last_error, refresh_token_expires_at
  from public.qbo_connections
  where user_id = auth.uid();
$$;

revoke all on function public.my_qbo_connection() from public, anon;
grant execute on function public.my_qbo_connection() to authenticated;

-- ── OAuth state (CSRF) ──────────────────────────────────────────────

create table public.qbo_oauth_states (
  state      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  return_to  text,
  created_at timestamptz not null default now()
);

alter table public.qbo_oauth_states enable row level security;
-- No policies: written by qbo-connect, consumed once by qbo-callback.

-- ── Mapping: add the billing item ───────────────────────────────────

alter table public.qbo_account_mappings
  drop constraint if exists qbo_account_mappings_item_category_check;
alter table public.qbo_account_mappings
  add constraint qbo_account_mappings_item_category_check
  check (item_category in ('labor', 'material', 'equipment', 'disposal', 'design', 'other', 'wip_offset', 'billing'));

alter table public.qbo_account_mappings
  add column if not exists qbo_item_id   text,
  add column if not exists qbo_item_name text;

comment on column public.qbo_account_mappings.qbo_item_id is
  'For the ''billing'' row: the QuickBooks service Item every invoice line posts to.';

-- ── Remembered ids ──────────────────────────────────────────────────

alter table public.customers
  add column if not exists qbo_customer_id text;

alter table public.invoices
  add column if not exists qbo_invoice_id  text,
  add column if not exists qbo_synced_at   timestamptz,
  add column if not exists qbo_sync_error  text;

alter table public.invoice_payments
  add column if not exists qbo_payment_id text;

-- ── Sync log ────────────────────────────────────────────────────────

create table public.qbo_sync_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('customer', 'invoice', 'payment', 'journal', 'connect', 'disconnect')),
  entity_id  uuid,
  qbo_id     text,
  status     text not null check (status in ('ok', 'error')),
  message    text,
  created_at timestamptz not null default now()
);

create index qbo_sync_log_user_idx on public.qbo_sync_log (user_id, created_at desc);

alter table public.qbo_sync_log enable row level security;
create policy qbo_sync_log_owner_select on public.qbo_sync_log
  for select using (user_id = auth.uid());
