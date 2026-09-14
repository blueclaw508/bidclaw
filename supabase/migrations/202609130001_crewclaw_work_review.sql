create table public.crewclaw_work_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null,
  record_id uuid not null,
  work_date date not null,
  progress text not null check (progress in ('ongoing','done')),
  summary text not null default '',
  time_entries jsonb not null default '[]'::jsonb check (jsonb_typeof(time_entries) = 'array'),
  materials jsonb not null default '[]'::jsonb check (jsonb_typeof(materials) = 'array'),
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array'),
  total_seconds integer not null default 0 check (total_seconds >= 0),
  submitted_by uuid,
  submitted_at timestamptz,
  crewclaw_approved_by uuid,
  crewclaw_approved_at timestamptz,
  payload_hash text not null check (length(payload_hash) = 64),
  status text not null default 'needs_review' check (status in ('needs_review','posted','rejected')),
  manager_note text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, record_id)
);

create index crewclaw_work_reviews_user_status_idx on public.crewclaw_work_reviews (user_id, status, work_date desc);
create index crewclaw_work_reviews_project_idx on public.crewclaw_work_reviews (project_id, work_date desc);
alter table public.crewclaw_work_reviews enable row level security;
create policy crewclaw_work_reviews_owner_select on public.crewclaw_work_reviews for select using (user_id = auth.uid());
revoke all on public.crewclaw_work_reviews from public, anon;
grant select on public.crewclaw_work_reviews to authenticated;
grant all on public.crewclaw_work_reviews to service_role;

create trigger crewclaw_work_reviews_updated_at before update on public.crewclaw_work_reviews
  for each row execute function public.tg_set_updated_at();

create or replace function public.review_crewclaw_work(p_review uuid, p_decision text, p_note text default '')
returns public.crewclaw_work_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.crewclaw_work_reviews;
begin
  if p_decision not in ('posted','rejected') then raise exception 'Choose post or reject'; end if;
  if length(coalesce(p_note,'')) > 2000 then raise exception 'Review note is too long'; end if;
  update public.crewclaw_work_reviews
     set status = p_decision, manager_note = trim(coalesce(p_note,'')),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_review and user_id = auth.uid() and status = 'needs_review'
   returning * into v_row;
  if v_row.id is null then raise exception 'Review is unavailable or already decided'; end if;
  return v_row;
end $$;
revoke all on function public.review_crewclaw_work(uuid,text,text) from public, anon;
grant execute on function public.review_crewclaw_work(uuid,text,text) to authenticated;

comment on table public.crewclaw_work_reviews is 'CrewClaw daily execution records for manager review. Does not modify estimates, proposal scope, or approved pricing.';
