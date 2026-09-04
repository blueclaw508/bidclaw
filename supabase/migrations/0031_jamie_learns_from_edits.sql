-- 0031 — Jamie learns from what this company enters and edits.
--
-- Ian, 2026-09-04: "I want Jamie to learn from what they enter and what they
-- edit and propose... looking for their kits, looking for their history, and
-- if nothing else going on the web... so it can build and evolve custom for
-- each company and not be tied to Blue Claw's way of doing things."
--
-- The precedence chain was already WRITTEN into Jamie's prompt — it tells her
-- to use "what they have corrected you on before" and "their own kits and
-- past work areas". Neither was ever supplied: BrainContext carried labor
-- types, equipment rates, catalog and kits, full stop. The prompt was writing
-- cheques the data layer didn't cash.
--
-- The correction signal has been accumulating the whole time and nothing read
-- it. jamie_proposed_lines.inserted_work_area_line_id already links every
-- line Jamie proposed to the row that actually landed, so the diff between
-- what she said and what the contractor changed it to is a plain join. On the
-- founder's own data that join returns Processed Dense Grade corrected $28 to
-- $40 three separate times, and equipment hours cut on every single job.
--
-- NOTHING HERE IS SEEDED AND NOTHING CROSSES ACCOUNTS. Both functions are
-- scoped to one user_id. A blank company gets empty results and Jamie falls
-- through to trade knowledge + the web, exactly as she does today. What a
-- company learns is theirs alone.

-- ── Their price book, learned from use ────────────────────────────────
-- The unit cost a contractor ACTUALLY used, per item, most recent first.
-- Directly transferable: if they buy stone dust at $40/ton, that is simply
-- what stone dust costs for them, on every future job.
--
-- Covers lines they typed themselves as well as lines Jamie proposed, so it
-- works for a company that never uses Jamie's takeoff at all. `corrections`
-- counts how many times this item's landed cost differed from what Jamie
-- proposed — the difference between "they priced this" and "they corrected me
-- on this", which the prompt presents differently.
create or replace function public.jamie_price_book(
  p_user_id uuid,
  p_limit integer default 60
)
returns table (
  category text,
  label text,
  unit text,
  unit_cost numeric,
  times_used bigint,
  corrections bigint,
  last_used timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select wl.category, wl.label, wl.unit, wl.unit_cost, wl.updated_at, wl.id
    from public.work_area_lines wl
    join public.work_areas wa on wa.id = wl.work_area_id
    join public.projects p on p.id = wa.project_id
    where p.user_id = p_user_id
      and wl.unit_cost is not null
      and wl.unit_cost > 0
      and btrim(coalesce(wl.label, '')) <> ''
  ),
  corrected as (
    select jpl.inserted_work_area_line_id as line_id
    from public.jamie_proposed_lines jpl
    join lines l on l.id = jpl.inserted_work_area_line_id
    where jpl.unit_cost is distinct from l.unit_cost
  ),
  ranked as (
    select l.*,
           row_number() over (
             partition by lower(btrim(l.label)), l.category
             order by l.updated_at desc
           ) as rn,
           count(*) over (partition by lower(btrim(l.label)), l.category) as uses,
           count(c.line_id) over (partition by lower(btrim(l.label)), l.category) as fixes,
           min(l.unit_cost) over (partition by lower(btrim(l.label)), l.category) as lo,
           max(l.unit_cost) over (partition by lower(btrim(l.label)), l.category) as hi
    from lines l
    left join corrected c on c.line_id = l.id
  )
  select category, label, unit, unit_cost, uses, fixes, updated_at
  from ranked
  where rn = 1
    -- Stability filter. A label whose cost swings by more than 3x across
    -- uses is not a unit price — it is a plug. The founder's "General
    -- Conditions & Rounding" line runs $0.30 to $1,100.08 across 44 uses;
    -- handing Jamie "$0.30" as its cost would be worse than telling her
    -- nothing. A single use is trusted as-is: there is no spread to judge.
    and (uses = 1 or hi <= lo * 3)
  order by uses desc, updated_at desc
  limit greatest(p_limit, 0);
$$;

comment on function public.jamie_price_book(uuid, integer) is
  'One company''s learned price book: the unit cost they actually used per item, most-used first. Scoped to p_user_id — never crosses accounts, never seeded.';

-- ── Where Jamie's QUANTITIES run high or low ──────────────────────────
-- A quantity correction is not directly portable the way a price is — 8 mixer
-- hours on a 600 SF patio says nothing about a 2,000 SF one. The RATIO is
-- what carries: consistently cutting her equipment hours by a third is a
-- tendency worth telling her about, so she stops making the same shaped
-- mistake. Only items corrected more than once are returned; a single edit is
-- a job-specific call, not a pattern.
create or replace function public.jamie_quantity_bias(
  p_user_id uuid,
  p_limit integer default 20
)
returns table (
  category text,
  label text,
  samples bigint,
  avg_ratio numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select wl.category,
         min(wl.label) as label,
         count(*) as samples,
         round(avg(wl.quantity / nullif(jpl.quantity, 0)), 2) as avg_ratio
  from public.jamie_proposed_lines jpl
  join public.work_area_lines wl on wl.id = jpl.inserted_work_area_line_id
  join public.work_areas wa on wa.id = wl.work_area_id
  join public.projects p on p.id = wa.project_id
  where p.user_id = p_user_id
    and jpl.quantity is not null and jpl.quantity > 0
    and wl.quantity is not null and wl.quantity > 0
    and wl.quantity is distinct from jpl.quantity
  group by wl.category, lower(btrim(wl.label))
  having count(*) > 1
  order by count(*) desc, abs(1 - avg(wl.quantity / nullif(jpl.quantity, 0))) desc
  limit greatest(p_limit, 0);
$$;

comment on function public.jamie_quantity_bias(uuid, integer) is
  'Where this company repeatedly corrects Jamie''s quantities, as a ratio (final/proposed). >1 = she under-calls, <1 = she pads. Scoped to p_user_id.';

-- Callable by the edge function's service role and by the owner (the
-- functions filter on p_user_id themselves, and are SECURITY DEFINER so they
-- can read across the join without widening any RLS policy).
grant execute on function public.jamie_price_book(uuid, integer) to authenticated, service_role;
grant execute on function public.jamie_quantity_bias(uuid, integer) to authenticated, service_role;
