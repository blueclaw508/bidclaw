-- 0039 — divisions for My Numbers.
--
-- A contractor does not run one set of rates. KYN has always known this:
-- its model is divisional, each division carrying its own crews, equipment,
-- burden and markups. BidClaw held one flat set, so importing a KYN model
-- meant either picking one division and abandoning the rest, or averaging
-- numbers that were never meant to be averaged.
--
-- Ian, 2026-09-05: "Give BidClaw divisions, let user select which divisions
-- to export."
--
-- SCOPE, DELIBERATELY BOUNDED. A division here groups RATES. It does not
-- scope estimating: a work-area line can still reach any rate the company
-- has, because forcing a project to declare a division before it can be
-- priced would change every estimate screen and every rollup, and nothing
-- about importing two sets of rates requires it. If division-scoped
-- estimating is wanted later it builds cleanly on this; doing it now would
-- be a different, much larger change riding in on a data-import problem.

create table if not exists public.company_divisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 1,

  -- Provenance, when the division arrived from a KYN import. Lets a repeat
  -- import update the division it created last time instead of making a
  -- second one beside it.
  kyn_year            integer,
  kyn_division_index  integer,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint company_divisions_name_not_blank check (btrim(name) <> ''),
  constraint company_divisions_user_name_unique unique (user_id, name)
);

create index if not exists company_divisions_user_idx
  on public.company_divisions (user_id, sort_order);

alter table public.company_divisions enable row level security;

create policy "company_divisions_select_own" on public.company_divisions
  for select using (user_id = auth.uid());
create policy "company_divisions_insert_own" on public.company_divisions
  for insert with check (user_id = auth.uid());
create policy "company_divisions_update_own" on public.company_divisions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "company_divisions_delete_own" on public.company_divisions
  for delete using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- Rates belong to a division — or to none
-- ────────────────────────────────────────────────────────────────────
--
-- NULLABLE on purpose, and that is the backward-compatibility story: every
-- existing rate stays unassigned, every existing company keeps exactly the
-- flat list it has today, and a contractor who never wants divisions never
-- meets one. Divisions are something you opt into by creating one.
--
-- ON DELETE SET NULL: removing a division must not delete the rates inside
-- it. They fall back to ungrouped, where they are still visible and still
-- referenced by any kit that used them.
alter table public.company_labor_types
  add column if not exists division_id uuid
    references public.company_divisions(id) on delete set null;

alter table public.company_equipment_rates
  add column if not exists division_id uuid
    references public.company_divisions(id) on delete set null;

create index if not exists company_labor_types_division_idx
  on public.company_labor_types (division_id) where division_id is not null;
create index if not exists company_equipment_rates_division_idx
  on public.company_equipment_rates (division_id) where division_id is not null;

comment on table public.company_divisions is
  'Groups a contractor''s labor and equipment rates. Optional: rates with a NULL division_id are simply ungrouped, which is how every account looked before this existed.';
comment on column public.company_labor_types.division_id is
  'Owning division, or NULL for ungrouped. SET NULL on division delete — removing a division never removes the rates in it.';
