-- Match estimateLineTotal: rounded base, category markup, rounded line, then sum.
-- Transactional import; caller's existing company RLS remains in force.
-- Request UUID is the new project ID. Locking the source lead makes retries idempotent.
create or replace function public.import_proposal_for_lead(p_lead_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := public.my_workspace_owner();
  v_lead public.leads%rowtype;
  v_customer uuid;
  v_area uuid;
  v_a jsonb;
  v_l jsonb;
  v_index integer := 0;
  v_lines integer := 0;
  v_total numeric := 0;
  v_existing public.projects%rowtype;
  v_marker text := 'Lead import: ' || p_lead_id::text || '; request: ' || p_request_id::text;
begin
  if auth.uid() is null or v_owner is null or p_request_id is null then raise exception 'Sign in to import a proposal.'; end if;
  select * into v_lead from public.leads where id=p_lead_id and user_id=v_owner for update;
  if not found then raise exception 'Lead not found in your company.'; end if;
  select * into v_existing from public.projects where id=p_request_id;
  if found then
    if v_existing.user_id <> v_owner or split_part(coalesce(v_existing.notes,''), E'\n',1) <> v_marker then raise exception 'Import request already used.'; end if;
    return jsonb_build_object('projectId',v_existing.id,'customerId',v_existing.customer_id,'leadId',p_lead_id,'workAreaCount',(select count(*) from public.work_areas where project_id=p_request_id),'lineCount',(select count(*) from public.work_area_lines l join public.work_areas w on w.id=l.work_area_id where w.project_id=p_request_id),'optionCount',coalesce((p_payload->>'option_count')::integer,0));
  end if;
  if nullif(btrim(p_payload->>'name'),'') is null or jsonb_typeof(p_payload->'areas') is distinct from 'array' then raise exception 'Name and work areas are required.'; end if;
  if jsonb_array_length(p_payload->'areas') not between 1 and 100 then raise exception 'Include 1 to 100 work areas.'; end if;
  if v_lead.project_id is not null then select customer_id into v_customer from public.projects where id=v_lead.project_id and user_id=v_owner; end if;
  if v_customer is null and nullif(btrim(p_payload->>'customer_name'),'') is not null then
    insert into public.customers(user_id,name,site_address,site_address_city) values(v_owner,btrim(p_payload->>'customer_name'),p_payload->>'site_address',p_payload->>'town') returning id into v_customer;
  end if;
  insert into public.projects(id,user_id,customer_id,name,status,site_address_city,notes)
  values(p_request_id,v_owner,v_customer,p_payload->>'name','estimating',p_payload->>'town',v_marker || E'\n\n' || coalesce(p_payload->>'notes',''));
  for v_a in select value from jsonb_array_elements(p_payload->'areas') loop
    if nullif(btrim(v_a->>'name'),'') is null or jsonb_typeof(v_a->'lines') is distinct from 'array' then raise exception 'Each work area needs a name and lines.'; end if;
    if jsonb_array_length(v_a->'lines') not between 1 and 300 then raise exception 'Invalid work area lines.'; end if;
    insert into public.work_areas(project_id,name,description,sequence_order,estimate_status)
    values(p_request_id,v_a->>'name',v_a->>'scope',v_index,'drafting') returning id into v_area;
    v_index := v_index+1;
    for v_l in select value from jsonb_array_elements(v_a->'lines') loop
      if (v_l->>'quantity')::numeric is null or (v_l->>'unit_cost')::numeric is null or (v_l->>'markup_override')::numeric not between 0 and 1000 then raise exception 'Invalid line amounts.'; end if;
      insert into public.work_area_lines(work_area_id,category,label,unit,quantity,unit_cost,markup_override,price_override,sort_order)
      values(v_area,v_l->>'category',v_l->>'label',v_l->>'unit',(v_l->>'quantity')::numeric,(v_l->>'unit_cost')::numeric,(v_l->>'markup_override')::numeric,(v_l->>'price_override')::numeric,(v_l->>'sort_order')::integer);
      v_total := v_total + round(coalesce((v_l->>'price_override')::numeric,round((v_l->>'quantity')::numeric*(v_l->>'unit_cost')::numeric,2)*(1+case when v_l->>'category' in ('material','subcontractor','other') then (v_l->>'markup_override')::numeric else 0 end/100)),2);
      v_lines := v_lines+1;
    end loop;
  end loop;
  if v_lead.project_id is null then
    update public.leads set project_id=p_request_id,stage='estimating',est_value=round(v_total,2) where id=p_lead_id;
  end if;
  insert into public.lead_notes(lead_id,body) values(p_lead_id,'Rebuilt estimate: /app/projects/' || p_request_id::text || '?tab=work_areas' || E'\n' || (p_payload->>'name'));
  return jsonb_build_object('projectId',p_request_id,'customerId',v_customer,'leadId',p_lead_id,'workAreaCount',v_index,'lineCount',v_lines,'optionCount',coalesce((p_payload->>'option_count')::integer,0));
end;
$$;
revoke all on function public.import_proposal_for_lead(uuid,uuid,jsonb) from public, anon;
grant execute on function public.import_proposal_for_lead(uuid,uuid,jsonb) to authenticated;
