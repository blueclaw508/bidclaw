-- Preserve existing and imported prices. New material creation explicitly opts in.
alter table public.work_area_lines add column sales_tax_percent numeric not null default 0
  check (sales_tax_percent >= 0 and sales_tax_percent <= 100);
comment on column public.work_area_lines.sales_tax_percent is 'Purchase tax percentage applied to base cost before markup. 0 preserves existing/imported prices; new materials default to 6.25 in the editor.';
drop trigger company_activity_save on public.work_area_lines;
create trigger company_activity_save after insert or update on public.work_area_lines for each row
execute function bidclaw_private.record_company_activity('category,label,unit,quantity,unit_cost,sales_tax_percent,price_override,markup_override,sort_order','Estimate line');
