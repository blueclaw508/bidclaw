-- Additive metadata only. Existing catalog costs and all estimate/proposal rows remain unchanged.
alter table public.catalog_items add column if not exists supplier_quote jsonb;

create or replace function public.validate_catalog_supplier_quote()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
declare q jsonb; quoted date; expiry date;
begin
  if tg_op = 'UPDATE' and (
    new.unit_cost is distinct from old.unit_cost or new.unit is distinct from old.unit
    or new.name is distinct from old.name or new.description is distinct from old.description
    or new.category is distinct from old.category
  ) then
    -- Any product/spec/price change requires a separate fresh confirmation.
    new.supplier_quote := null;
    return new;
  end if;
  q := new.supplier_quote;
  if q is null then return new; end if;
  if tg_op = 'UPDATE' and q is not distinct from old.supplier_quote then return new; end if;
  if jsonb_typeof(q) <> 'object'
    or coalesce(length(trim(q->>'supplier')),0) not between 1 and 200
    or coalesce(length(trim(q->>'reference')),0) not between 1 and 1000
    or (q->>'unit_cost')::numeric is distinct from new.unit_cost
    or q->>'unit' is distinct from new.unit
    or new.unit_cost <= 0
    or coalesce(q->>'quoted_on','') !~ '^\d{4}-\d{2}-\d{2}$'
  then raise exception 'Supplier quote must identify the supplier, reference, date and matching catalog price/unit.'; end if;
  quoted := (q->>'quoted_on')::date;
  expiry := nullif(q->>'expires_on','')::date;
  if quoted > current_date or (expiry is not null and expiry < quoted) then
    raise exception 'Quote dates are invalid.';
  end if;
  new.supplier_quote := jsonb_build_object(
    'supplier',trim(q->>'supplier'),'reference',trim(q->>'reference'),
    'quoted_on',quoted,'expires_on',expiry,'unit_cost',new.unit_cost,'unit',new.unit,
    'confirmed_at',clock_timestamp()
  );
  return new;
end $$;
revoke all on function public.validate_catalog_supplier_quote() from public, anon, authenticated;
create trigger catalog_supplier_quote_guard before insert or update on public.catalog_items
for each row execute function public.validate_catalog_supplier_quote();
