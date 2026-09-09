-- No backfill and no writes to existing estimates, proposals, rates or markups.
create table public.kyn_import_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  imported_at timestamptz not null default now(),
  source jsonb not null,
  divisions jsonb not null
);
alter table public.kyn_import_history enable row level security;
create policy "Read own KYN imports" on public.kyn_import_history
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.kyn_import_history to authenticated;
grant all on public.kyn_import_history to service_role;

create or replace function public.apply_kyn_import_v2(
  p_user uuid, p_snapshot jsonb, p_plans jsonb, p_source jsonb
) returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  actual jsonb; plan jsonb; item jsonb; division_id_new uuid;
  next_sort integer; next_labor integer; next_equipment integer;
begin
  -- Blocks concurrent catalog edits only for this short transaction, including
  -- old import clients. Recheck the exact preview snapshot before any write.
  lock table public.company_divisions, public.company_labor_types,
    public.company_equipment_rates in share row exclusive mode;
  select jsonb_build_object(
    'divisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.company_divisions d where user_id=p_user),'[]'::jsonb),
    'labor', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.company_labor_types l where user_id=p_user),'[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.company_equipment_rates e where user_id=p_user),'[]'::jsonb)
  ) into actual;
  if actual is distinct from p_snapshot then raise exception 'Stale KYN import preview'; end if;
  if jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans)=0 then raise exception 'Empty import'; end if;
  select coalesce(max(sort_order),0) into next_sort from public.company_divisions where user_id=p_user;
  select coalesce(max(slot_number),0) into next_labor from public.company_labor_types where user_id=p_user;
  select coalesce(max(slot_number),0) into next_equipment from public.company_equipment_rates where user_id=p_user;
  for plan in select value from jsonb_array_elements(p_plans) loop
    division_id_new := (plan->>'targetId')::uuid;
    if division_id_new is null then
      next_sort := next_sort+1;
      insert into public.company_divisions(user_id,name,sort_order,kyn_year,kyn_division_index,markup_materials_percent,markup_subs_percent)
      values(p_user,plan->>'division',next_sort,(p_source->>'year')::integer,(plan->>'kynIndex')::integer,
        (plan#>>'{markups,materials}')::numeric,(plan#>>'{markups,subs}')::numeric) returning id into division_id_new;
    elsif not exists(select 1 from public.company_divisions where id=division_id_new and user_id=p_user) then
      raise exception 'Division owner mismatch';
    end if;
    for item in select value from jsonb_array_elements(plan#>'{labor,incoming}') loop
      if item->>'action' = 'add' then
        next_labor := next_labor+1;
        insert into public.company_labor_types(user_id,division_id,slot_number,name,rate_per_hour)
        values(p_user,division_id_new,next_labor,item->>'name',(item->>'rate')::numeric);
      end if;
    end loop;
    for item in select value from jsonb_array_elements(plan#>'{equipment,incoming}') loop
      if item->>'action' = 'add' then
        next_equipment := next_equipment+1;
        insert into public.company_equipment_rates(user_id,division_id,slot_number,name,rate_per_hour)
        values(p_user,division_id_new,next_equipment,item->>'name',(item->>'rate')::numeric);
      end if;
    end loop;
  end loop;
  insert into public.kyn_import_history(user_id,source,divisions) values(p_user,p_source,p_plans);
end;
$$;
revoke all on function public.apply_kyn_import_v2(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_kyn_import_v2(uuid,jsonb,jsonb,jsonb) to service_role;
