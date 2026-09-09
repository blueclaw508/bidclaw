-- A conversational correction must not leave old crew instructions behind.
-- Service-only entry point; the edge handler verifies JWT and run ownership.
create or replace function public.revise_jamie_takeoff(p_run_id uuid, p_updates jsonb)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  line public.jamie_proposed_lines%rowtype;
  affected uuid[] := '{}';
  ids uuid[] := '{}';
  parent_id uuid;
  scope_text text;
  n integer;
begin
  if jsonb_typeof(p_updates) is distinct from 'array' or jsonb_array_length(p_updates) = 0 then
    raise exception 'A complete nonempty revision is required';
  end if;
  perform 1 from public.jamie_loop_runs
    where id = p_run_id and status = 'awaiting_line_approval' for update;
  if not found then raise exception 'Run is not awaiting takeoff review'; end if;

  for item in select value from jsonb_array_elements(p_updates) loop
    if (item->>'line_id')::uuid = any(ids) then raise exception 'Duplicate line in revision'; end if;
    select l.* into line from public.jamie_proposed_lines l
      join public.jamie_proposed_work_areas w on w.id = l.jamie_proposed_work_area_id
      where l.id = (item->>'line_id')::uuid and l.status = 'pending'
        and w.jamie_run_id = p_run_id and w.status = 'approved'
      for update of l, w;
    if not found then raise exception 'Line is not pending in this run'; end if;
    if jsonb_typeof(item->'unit_cost') is distinct from 'number'
      or (item->>'unit_cost')::numeric <= 0
      or not (item ? 'quantity')
      or (item->'quantity' <> 'null'::jsonb and
        (jsonb_typeof(item->'quantity') <> 'number' or (item->>'quantity')::numeric <= 0))
      or length(btrim(coalesce(item->>'reasoning', ''))) = 0
      or length(btrim(coalesce(item->>'work_order_scope', ''))) = 0 then
      raise exception 'Positive numbers, revised reasoning and complete crew instructions are required';
    end if;
    ids := array_append(ids, line.id);
    if not line.jamie_proposed_work_area_id = any(affected) then
      affected := array_append(affected, line.jamie_proposed_work_area_id);
    end if;
  end loop;

  foreach parent_id in array affected loop
    if exists(select 1 from public.jamie_proposed_lines
      where jamie_proposed_work_area_id = parent_id and status = 'pending' and not id = any(ids)) then
      raise exception 'Include every pending line of each affected work area so all explanations stay current';
    end if;
    select count(distinct x.value->>'work_order_scope'), min(x.value->>'work_order_scope')
      into n, scope_text
      from jsonb_array_elements(p_updates) x
      join public.jamie_proposed_lines l on l.id = (x.value->>'line_id')::uuid
      where l.jamie_proposed_work_area_id = parent_id;
    if n <> 1 then raise exception 'Crew instructions must agree across a work area'; end if;
    update public.jamie_proposed_work_areas set proposed_description = scope_text where id = parent_id;
  end loop;

  for item in select value from jsonb_array_elements(p_updates) loop
    update public.jamie_proposed_lines set
      unit_cost = (item->>'unit_cost')::numeric,
      quantity = coalesce((item->>'quantity')::numeric, quantity),
      reasoning = item->>'reasoning'
      where id = (item->>'line_id')::uuid;
  end loop;
  return array_length(ids, 1);
end;
$$;
revoke all on function public.revise_jamie_takeoff(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.revise_jamie_takeoff(uuid, jsonb) to service_role;
