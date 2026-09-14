create table public.company_activity (
 id bigint generated always as identity primary key,
 owner_id uuid not null,
 actor_id uuid,
 actor_email text,
 occurred_at timestamptz not null default clock_timestamp(),
 entity_type text not null,
 entity_id uuid not null,
 entity_name text not null,
 project_id uuid,
 project_name text,
 action text not null check (action in ('created','updated','deleted')),
 changes jsonb not null,
 owner_only boolean not null default false
);
create index company_activity_recent on public.company_activity(owner_id,id desc);
create index company_activity_project on public.company_activity(owner_id,project_id,id desc);
alter table public.company_activity enable row level security;
revoke all on public.company_activity from public,anon,authenticated;
grant select on public.company_activity to authenticated;
revoke all on sequence public.company_activity_id_seq from public,anon,authenticated;
create policy company_activity_read on public.company_activity for select to authenticated
 using (owner_id=(select bidclaw_private.workspace_owner()) and (not owner_only or owner_id=(select auth.uid())));

-- Only triggers write the history. Never trust an actor supplied by a browser.
-- Explicit field lists exclude share tokens, signatures and integration credentials.
create function bidclaw_private.record_company_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 old_doc jsonb := '{}'::jsonb; new_doc jsonb := '{}'::jsonb; doc jsonb;
 diff jsonb := '{}'::jsonb; field text; owner uuid; project uuid;
 project_label text; parent uuid; actor uuid:=auth.uid(); actor_label text;
begin
 if TG_OP<>'INSERT' then old_doc:=to_jsonb(old); end if;
 if TG_OP<>'DELETE' then new_doc:=to_jsonb(new); end if;
 doc:=case when TG_OP='DELETE' then old_doc else new_doc end;
 foreach field in array string_to_array(TG_ARGV[0],',') loop
  if (old_doc->field) is distinct from (new_doc->field) then
   diff:=diff || jsonb_build_object(field,jsonb_build_object('before',old_doc->field,'after',new_doc->field));
  end if;
 end loop;
 if diff='{}'::jsonb then return coalesce(new,old); end if;
 owner:=coalesce((doc->>'user_id')::uuid,(doc->>'owner_id')::uuid);
 project:=(doc->>'project_id')::uuid;
 if TG_TABLE_NAME='projects' then project:=(doc->>'id')::uuid; project_label:=doc->>'name'; end if;
 if TG_TABLE_NAME='work_area_lines' then
  parent:=(doc->>'work_area_id')::uuid;
  select w.project_id into project from public.work_areas w where w.id=parent;
 elsif doc ? 'proposal_id' then
  parent:=(doc->>'proposal_id')::uuid;
  select p.project_id into project from public.proposals p where p.id=parent;
 end if;
 -- Parent delete events were recorded before cascades removed their children.
 if project is null and parent is not null then
  select a.project_id,a.owner_id,a.project_name into project,owner,project_label
  from public.company_activity a where a.entity_id=parent and a.entity_type in ('work_areas','proposals') order by a.id desc limit 1;
 end if;
 if project is not null and TG_TABLE_NAME<>'projects' then
  select p.user_id,p.name into owner,project_label from public.projects p where p.id=project;
  if owner is null then
   select a.owner_id,a.project_name into owner,project_label from public.company_activity a
   where a.entity_type='projects' and a.entity_id=project order by a.id desc limit 1;
  end if;
 end if;
 if owner is null then raise exception 'Cannot resolve activity workspace for %',TG_TABLE_NAME; end if;
 if actor is not null then select u.email into actor_label from auth.users u where u.id=actor; end if;
 insert into public.company_activity(owner_id,actor_id,actor_email,entity_type,entity_id,entity_name,project_id,project_name,action,changes,owner_only)
 values(owner,actor,actor_label,TG_TABLE_NAME,(doc->>'id')::uuid,
 coalesce(doc->>'name',doc->>'label',doc->>'email',doc->>'name_override',TG_ARGV[1]),
 project,project_label,case TG_OP when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,diff,TG_TABLE_NAME='company_admin_members');
 return coalesce(new,old);
end $$;
revoke all on function bidclaw_private.record_company_activity() from public,anon,authenticated;

do $$
declare spec text[];
begin
 foreach spec slice 1 in array array[
 ['projects','name,status,customer_id,site_address,notes,site_address_line1,site_address_city,site_address_state,site_address_zip','Project'],
 ['work_areas','name,description,client_description,status,estimate_status,sequence_order,division_id','Work area'],
 ['work_area_lines','category,label,unit,quantity,unit_cost,price_override,markup_override,sort_order','Estimate line'],
 ['proposals','name,status,notes,presented_at,approved_at,show_grand_total,terms_and_conditions,payment_milestones','Proposal'],
 ['proposal_lines','category,label,unit,quantity,frozen_unit_cost,frozen_labor_rate,frozen_equipment_rate,frozen_markup_percent,price_override,sort_order','Proposal line'],
 ['proposal_work_areas','name_override,description_override,enabled,position','Proposal scope'],
 ['construction_schedule','proposal_id,crew_id,work_date,planned_hours,field_notes,status','Work order schedule'],
 ['crewclaw_work_reviews','status,manager_note,reviewed_by,reviewed_at,summary','Work review'],
 ['company_admin_members','email,active','Administrator access']
 ] loop
  execute format('create trigger company_activity_save after insert or update on public.%I for each row execute function bidclaw_private.record_company_activity(%L,%L)',spec[1],spec[2],spec[3]);
  execute format('create trigger company_activity_delete before delete on public.%I for each row execute function bidclaw_private.record_company_activity(%L,%L)',spec[1],spec[2],spec[3]);
 end loop;
end $$;
comment on table public.company_activity is 'Append-only business activity from installation onward. Null actor means a system or client action without an authenticated staff session. No historical attribution is inferred.';
