-- ============================================================
-- BidClaw v1.1 — Corrected Schema (Quantities Only)
-- BidClaw collects quantities and raw costs only.
-- All pricing, markups, and KYN calculations happen in QuickCalc.
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- TABLES
-- ──────────────────────────────────────────────────────────────

-- Company profile (one per account)
create table companies (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  logo_url text,
  street text,
  city text,
  state text,
  zip text,
  typical_crew_size int default 3,
  crew_full_day_hours numeric default 9,
  crew_half_day_hours numeric default 4.5,
  estimating_methodology text,
  created_at timestamptz default now(),
  unique(user_id)
);

-- Production rates
create table production_rates (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  work_type text not null,
  unit text not null,
  man_hours_per_unit numeric not null,
  notes text
);

-- Item Catalog — Materials
create table materials_catalog (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  um text,          -- Unit of Measure (SF, CY, LF, EA, ton, bag, roll)
  unit text not null,
  unit_cost numeric not null,
  supplier text,
  notes text
);

-- Item Catalog — Subcontractors
create table subs_catalog (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  um text,          -- Unit of Measure
  unit text not null,
  unit_cost numeric not null,
  trade text,
  notes text
);

-- Item Catalog — Equipment (names only, no rates)
create table equipment_catalog (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  billable boolean default true
);

-- Item Catalog — Disposal Fees/Other
create table disposal_catalog (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  um text,          -- Unit of Measure
  unit text not null,
  unit_cost numeric not null,
  notes text
);

-- Work types library
create table work_types (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  category text not null,
  default_notes_template text
);

-- Estimates
create table estimates (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  client_name text not null,
  client_email text,
  job_address text,
  job_city text,
  job_state text,
  job_zip text,
  spec_source text not null default 'site_visit',
  plan_url text,
  status text not null default 'draft',
  ai_conversation jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Work areas
create table work_areas (
  id uuid primary key default uuid_generate_v4(),
  estimate_id uuid references estimates(id) on delete cascade not null,
  name text not null,
  sort_order int default 0,
  ai_generated boolean default true,
  approved boolean default false,
  notes text[] default '{}',
  total_man_hours numeric,
  day_increment text
);

-- Line items
create table line_items (
  id uuid primary key default uuid_generate_v4(),
  work_area_id uuid references work_areas(id) on delete cascade not null,
  type text not null,  -- 'material', 'equipment', 'labor', 'sub', 'disposal', 'general_conditions'
  name text not null,
  quantity numeric default 0,
  unit text,
  unit_cost numeric,
  total_cost numeric,
  ai_generated boolean default true,
  sort_order int default 0
);

-- Job efficiency tracking
create table job_efficiency (
  id uuid primary key default uuid_generate_v4(),
  estimate_id uuid references estimates(id) on delete cascade not null unique,
  budgeted_man_hours numeric not null,
  actual_man_hours numeric,
  efficiency_percent numeric,
  notes text,
  tracked_at timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at
-- ──────────────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger estimates_updated_at
  before update on estimates
  for each row execute function update_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

alter table companies enable row level security;
alter table production_rates enable row level security;
alter table materials_catalog enable row level security;
alter table subs_catalog enable row level security;
alter table equipment_catalog enable row level security;
alter table disposal_catalog enable row level security;
alter table work_types enable row level security;
alter table estimates enable row level security;
alter table work_areas enable row level security;
alter table line_items enable row level security;
alter table job_efficiency enable row level security;

-- Companies
create policy "Users manage own company"
  on companies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Helper function
create or replace function get_user_company_id()
returns uuid as $$
  select id from companies where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- Production rates
create policy "Users manage own production rates"
  on production_rates for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Materials catalog
create policy "Users manage own materials"
  on materials_catalog for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Subs catalog
create policy "Users manage own subs"
  on subs_catalog for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Equipment catalog
create policy "Users manage own equipment"
  on equipment_catalog for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Disposal catalog
create policy "Users manage own disposal"
  on disposal_catalog for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Work types
create policy "Users manage own work types"
  on work_types for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Estimates
create policy "Users manage own estimates"
  on estimates for all
  using (company_id = get_user_company_id())
  with check (company_id = get_user_company_id());

-- Work areas
create policy "Users manage own work areas"
  on work_areas for all
  using (
    estimate_id in (
      select id from estimates where company_id = get_user_company_id()
    )
  )
  with check (
    estimate_id in (
      select id from estimates where company_id = get_user_company_id()
    )
  );

-- Line items
create policy "Users manage own line items"
  on line_items for all
  using (
    work_area_id in (
      select wa.id from work_areas wa
      join estimates e on wa.estimate_id = e.id
      where e.company_id = get_user_company_id()
    )
  )
  with check (
    work_area_id in (
      select wa.id from work_areas wa
      join estimates e on wa.estimate_id = e.id
      where e.company_id = get_user_company_id()
    )
  );

-- Job efficiency
create policy "Users manage own job efficiency"
  on job_efficiency for all
  using (
    estimate_id in (
      select id from estimates where company_id = get_user_company_id()
    )
  )
  with check (
    estimate_id in (
      select id from estimates where company_id = get_user_company_id()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- STORAGE BUCKETS
-- ──────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('plans', 'plans', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "Users upload own plans"
  on storage.objects for insert
  with check (bucket_id = 'plans' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users read own plans"
  on storage.objects for select
  using (bucket_id = 'plans' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users upload own logos"
  on storage.objects for insert
  with check (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can read logos"
  on storage.objects for select
  using (bucket_id = 'logos');

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
