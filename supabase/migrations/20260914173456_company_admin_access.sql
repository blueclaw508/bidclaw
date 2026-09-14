-- Membership is separate from existing company data; no estimate or proposal is rewritten.
create schema if not exists bidclaw_private;
revoke all on schema bidclaw_private from public;
grant usage on schema bidclaw_private to authenticated;
create table public.company_admin_members (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 email text not null check(email=lower(trim(email)) and length(email)<=254),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(email)
);
alter table public.company_admin_members enable row level security;
revoke all on public.company_admin_members from anon,authenticated;
grant select on public.company_admin_members to authenticated;
create index company_admin_members_owner on public.company_admin_members(owner_id);

create function bidclaw_private.workspace_owner() returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce((select m.owner_id from public.company_admin_members m
 join auth.users u on lower(u.email)=m.email
 where u.id=auth.uid() and u.email_confirmed_at is not null and m.active),auth.uid());
$$;
revoke all on function bidclaw_private.workspace_owner() from public;
grant execute on function bidclaw_private.workspace_owner() to authenticated;
create function public.my_workspace_owner() returns uuid
language sql stable security invoker set search_path='' as $$ select bidclaw_private.workspace_owner(); $$;
revoke all on function public.my_workspace_owner() from public;
grant execute on function public.my_workspace_owner() to authenticated;
create policy company_admin_members_read on public.company_admin_members for select to authenticated
 using(owner_id=bidclaw_private.workspace_owner());

create function public.manage_company_admin(p_email text,p_active boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_email text:=lower(trim(p_email)); v_id uuid; v_target uuid;
begin
 if v_owner is null or v_owner<>bidclaw_private.workspace_owner() then raise exception 'Only the company owner can manage administrators'; end if;
 if not exists(select 1 from auth.users where id=v_owner and email_confirmed_at is not null) then raise exception 'Verify your email first'; end if;
 if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 select id into v_target from auth.users where lower(email)=v_email;
 if v_target=v_owner then raise exception 'The owner already has access and cannot be removed'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_email,0));
 if exists(select 1 from public.company_admin_members where email=v_email and owner_id<>v_owner) then raise exception 'This address belongs to another workspace'; end if;
 if p_active and v_target is not null and not exists(
 select 1 from public.company_admin_members where owner_id=v_owner and email=v_email
 ) then raise exception 'This email already has a separate BidClaw account. Contact support before changing its workspace'; end if;
 if not p_active then
  update public.company_admin_members set active=false,updated_at=now() where owner_id=v_owner and email=v_email returning id into v_id;
  if v_id is null then raise exception 'Administrator not found'; end if;
 else
  insert into public.company_admin_members(owner_id,email) values(v_owner,v_email)
  on conflict(email) do update set active=true,updated_at=now() returning id into v_id;
 end if;
 return v_id;
end $$;
revoke all on function public.manage_company_admin(text,boolean) from public;
grant execute on function public.manage_company_admin(text,boolean) to authenticated;

-- Preserve the existing allowlist; an active administrator may also verify their email and sign in.
create or replace function public.is_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.beta_allowlist where email=lower(trim(coalesce(p_email,''))))
 or exists(select 1 from public.company_admin_members where email=lower(trim(coalesce(p_email,''))) and active);
$$;

-- Change only business ownership predicates. Profiles, billing connections and identity remain personal.
do $$ declare p record; q text; c text;
begin
 for p in select * from pg_policies where schemaname='public' and tablename=any(array[
 'catalog_items','change_orders','company_divisions','company_equipment_rates','company_labor_types','company_settings',
 'construction_crews','construction_schedule','crewclaw_work_reviews','customers','invoice_lines','invoice_payments','invoices',
 'jamie_invocations','jamie_loop_runs','jamie_messages','jamie_proposed_lines','jamie_proposed_work_areas','jamie_runs','job_costs',
 'kit_lines','kits','kyn_import_history','lead_notes','leads','measurements','page_scales','project_files','projects',
 'proposal_lines','proposal_shares','proposal_signatures','proposal_work_areas','proposals','wip_entries','wip_periods','work_area_lines','work_areas'])
 loop
 q:=replace(p.qual,'auth.uid()','bidclaw_private.workspace_owner()');
 c:=replace(p.with_check,'auth.uid()','bidclaw_private.workspace_owner()');
 execute format('alter policy %I on %I.%I %s %s',p.policyname,p.schemaname,p.tablename,
 case when q is not null then 'using ('||q||')' else '' end,
 case when c is not null then 'with check ('||c||')' else '' end);
 end loop;
 for p in select * from pg_policies where schemaname='storage' and tablename='objects'
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%auth.uid()%'
 and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(plans|logos|company-assets|jamie-images|project-files)'
 loop
 q:=replace(p.qual,'auth.uid()','bidclaw_private.workspace_owner()');
 c:=replace(p.with_check,'auth.uid()','bidclaw_private.workspace_owner()');
 execute format('alter policy %I on storage.objects %s %s',p.policyname,
 case when q is not null then 'using ('||q||')' else '' end,
 case when c is not null then 'with check ('||c||')' else '' end);
 end loop;
end $$;

-- Defaults on new business rows must use the workspace, even when the caller omits user_id.
create function bidclaw_private.set_workspace_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is not null and new.user_id=auth.uid() then new.user_id:=bidclaw_private.workspace_owner(); end if;
 return new;
end $$;
revoke all on function bidclaw_private.set_workspace_owner() from public;
do $$ declare t text; begin
 foreach t in array array['catalog_items','change_orders','company_divisions','company_equipment_rates','company_labor_types',
 'construction_crews','construction_schedule','customers','invoices','jamie_loop_runs','jamie_runs','job_costs','kits','leads','projects','wip_periods'] loop
 execute format('create trigger a_workspace_owner before insert on public.%I for each row execute function bidclaw_private.set_workspace_owner()',t);
 end loop;
end $$;

-- Functions that enforce business ownership must use the same workspace predicate.
do $$ declare f record; s text; begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
 'create_proposal_share','revoke_proposal_share','project_needs_ai_trial_watermark','work_area_markups','my_plan','wip_snapshot','validate_construction_schedule','review_crewclaw_work']) loop
 s:=replace(pg_get_functiondef(f.oid),'auth.uid()','bidclaw_private.workspace_owner()');
 if f.proname='review_crewclaw_work' then s:=replace(s,'reviewed_by = bidclaw_private.workspace_owner()','reviewed_by = auth.uid()'); end if;
 execute s;
 end loop;
end $$;

create or replace function public.enforce_email_allowlist() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_email_allowed(new.email) then raise exception 'Signup not permitted for this email' using errcode='42501'; end if;
 return new;
end $$;
