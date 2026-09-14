create table public.construction_crews (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 name text not null check(length(trim(name)) between 1 and 150),
 region text not null check(region in ('Cape Cod','Nantucket','Metro Boston')),
 created_at timestamptz not null default now()
);
create unique index construction_crews_name on public.construction_crews(user_id,region,lower(trim(name)));
alter table public.construction_crews enable row level security;
revoke all on public.construction_crews from public,anon,authenticated;
grant select,insert on public.construction_crews to authenticated;
create policy crews_read on public.construction_crews for select to authenticated using(user_id=(select auth.uid()));
create policy crews_create on public.construction_crews for insert to authenticated with check(user_id=(select auth.uid()));

create table public.construction_schedule (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 proposal_id uuid not null references public.proposals(id),
 crew_id uuid not null references public.construction_crews(id),
 work_date date not null,
 planned_hours numeric(8,2) check(planned_hours>=0 and planned_hours<=10000),
 field_notes text not null default '' check(length(field_notes)<=4000),
 status text not null default 'scheduled' check(status in ('scheduled','ongoing','done','cancelled')),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index construction_schedule_owner_date on public.construction_schedule(user_id,work_date);
create index construction_schedule_proposal on public.construction_schedule(proposal_id);
create index construction_schedule_crew on public.construction_schedule(crew_id);
create unique index construction_schedule_no_duplicate on public.construction_schedule(user_id,proposal_id,crew_id,work_date) where status<>'cancelled';
alter table public.construction_schedule enable row level security;
revoke all on public.construction_schedule from public,anon,authenticated;
grant select,insert,update on public.construction_schedule to authenticated;
create policy schedule_read on public.construction_schedule for select to authenticated using(user_id=(select auth.uid()));
create policy schedule_create on public.construction_schedule for insert to authenticated with check(user_id=(select auth.uid()));
create policy schedule_change on public.construction_schedule for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.validate_construction_schedule() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Sign in as the schedule owner'; end if;
 if tg_op='UPDATE' then
  if new.id<>old.id or new.user_id<>old.user_id or new.created_at<>old.created_at then raise exception 'Schedule identity cannot change'; end if;
  if new.version<>old.version then raise exception 'Schedule changed; refresh before saving'; end if;
  new.version:=old.version+1;
 else new.version:=1; new.created_at:=now(); end if;
 if not exists(select 1 from public.construction_crews c where c.id=new.crew_id and c.user_id=auth.uid()) then raise exception 'Choose your construction crew'; end if;
 if not exists(select 1 from public.proposals p join public.projects j on j.id=p.project_id where p.id=new.proposal_id and j.user_id=auth.uid()
  and (new.status='cancelled' or (p.status='approved' and j.status<>'archived'))) then raise exception 'Choose an approved proposal in an active project'; end if;
 new.updated_at:=now(); return new;
end $$;
revoke all on function public.validate_construction_schedule() from public,anon;
create trigger validate_construction_schedule before insert or update on public.construction_schedule for each row execute function public.validate_construction_schedule();
comment on table public.construction_schedule is 'Office construction planning only. Does not change proposal scope, price, project status or CrewClaw access.';
