-- 0040 — a division carries its own markups, and a work area belongs to one.
--
-- 0039 gave divisions their own labor and equipment rates and left markups
-- company-wide, because a rate is a ROW a line points at (so it carries
-- its division for free) while a markup is a lookup by CATEGORY — nothing
-- the line references carries a division to look it up against.
--
-- That was the seam, not a good answer. KYN models it correctly: a division
-- that has its own crews and its own machines has its own materials and
-- subs markup. Jovanne's do. So the work area — one chunk of work, which
-- plausibly belongs to one division — becomes the thing that carries the
-- division, and the markup lookup consults that division first.
--
-- BOTH NULLABLE, both inheriting. A division with NULL markups uses the
-- company's; a work area with NULL division uses the company's. Every
-- existing work area and every existing division is NULL, so nothing
-- prices differently the moment this lands. Only a work area that has
-- been placed in a division that has set its own markups moves.

alter table public.company_divisions
  add column if not exists markup_materials_percent numeric,
  add column if not exists markup_subs_percent numeric;

comment on column public.company_divisions.markup_materials_percent is
  'Materials markup for work areas in this division. NULL = inherit the company-wide markup_materials_percent.';
comment on column public.company_divisions.markup_subs_percent is
  'Subs/other markup for work areas in this division. NULL = inherit the company-wide markup_subs_percent.';

-- SET NULL, not CASCADE: deleting a division must not delete work areas,
-- and must not delete estimates. They fall back to company markups.
alter table public.work_areas
  add column if not exists division_id uuid
    references public.company_divisions(id) on delete set null;

create index if not exists work_areas_division_idx
  on public.work_areas (division_id) where division_id is not null;

comment on column public.work_areas.division_id is
  'Which division this work area is priced under. Drives the default markup for its material/sub/other lines. NULL = company-wide markups.';

-- The work area's effective markups, resolved server-side so the proposal
-- freeze and the browser agree to the cent. Division wins where it has a
-- value; company otherwise. (resolveMarkups() in money.ts is the same
-- coalesce for callers that already hold both rows.)
create or replace function public.work_area_markups(p_work_area_id uuid)
returns table (markup_materials_percent numeric, markup_subs_percent numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(d.markup_materials_percent, cs.markup_materials_percent) as markup_materials_percent,
    coalesce(d.markup_subs_percent,      cs.markup_subs_percent)      as markup_subs_percent
  from public.work_areas wa
  join public.projects p on p.id = wa.project_id
  join public.company_settings cs on cs.user_id = p.user_id
  left join public.company_divisions d on d.id = wa.division_id
  where wa.id = p_work_area_id
    -- Only the owner may ask. SECURITY DEFINER reads past RLS, so the
    -- ownership check has to be explicit here.
    and p.user_id = auth.uid();
$function$;

revoke all on function public.work_area_markups(uuid) from public;
grant execute on function public.work_area_markups(uuid) to authenticated;
