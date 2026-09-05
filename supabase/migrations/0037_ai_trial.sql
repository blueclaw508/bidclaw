-- 0037 — one free Jamie estimate, for a tier that otherwise has none.
--
-- The funnel Ian wants: a comped KYN contractor lands on Pro, which has no
-- AI. Give them ONE Jamie estimate anyway, watermark what it produces, and
-- put the upgrade button exactly where they feel the loss.
--
-- WHY THE CAPS ARE COLUMNS AND NOT CONSTANTS. Getting to one committed
-- estimate can take many chat turns and image analyses, and every one is an
-- Opus call on Blue Claw's card. "One free estimate" is therefore not one
-- number, it is four: how many estimates, and how much work is allowed in
-- reaching them. Putting all four in the tier table makes "how much free AI
-- per lead" a data edit Ian makes himself, at any hour, without a deploy or
-- waiting on anyone. That is the whole reason this is not in jamieGate.ts.
--
-- LIFETIME, NOT MONTHLY. monthly_jamie_estimates would hand the same
-- contractor a free estimate every month forever, which is a free product
-- rather than a taste. These count everything the account has ever done.

alter table public.subscription_tier_limits
  add column if not exists ai_trial_estimates integer,
  add column if not exists ai_trial_invocations integer,
  add column if not exists ai_trial_turns_per_session integer,
  add column if not exists ai_trial_images_per_session integer;

comment on column public.subscription_tier_limits.ai_trial_estimates is
  'LIFETIME committed Jamie estimates allowed on a tier whose monthly_jamie_estimates is 0. NULL or 0 = no trial at all.';
comment on column public.subscription_tier_limits.ai_trial_invocations is
  'LIFETIME ceiling on total Jamie invocations during the trial. The cost guard: it bounds how much Opus a lead can burn while reaching their one estimate.';

-- Conservative opening numbers. Enough to have a real conversation with
-- Jamie and get one estimate out of her; not enough to run a business on.
-- Tune freely — nothing reads these but the gate.
update public.subscription_tier_limits
set ai_trial_estimates          = 1,
    ai_trial_invocations        = 12,
    ai_trial_turns_per_session  = 8,
    ai_trial_images_per_session = 6
where tier = 'pro';

-- The free tier already has its own limit (one proposal, manual). No AI
-- there: the AI taste is what Pro is for, and giving it away at free would
-- leave nothing to comp a KYN subscriber WITH.
update public.subscription_tier_limits
set ai_trial_estimates = 0
where tier = 'free';

-- ────────────────────────────────────────────────────────────────────
-- Marking what the trial produced
-- ────────────────────────────────────────────────────────────────────
--
-- Stamped when the gate allows the run, not inferred later. Inferring means
-- asking "did this account have AI back then?", and that answer flips the
-- instant they subscribe — exactly when we need to remember this run WAS a
-- trial, so the watermark can lift off the estimate they already made.
alter table public.jamie_loop_runs
  add column if not exists was_ai_trial boolean not null default false;

comment on column public.jamie_loop_runs.was_ai_trial is
  'True when this run was allowed by the one-free-estimate trial rather than by a paid AI tier. Drives the PREVIEW watermark on anything it produced, until the account actually has AI.';

-- ────────────────────────────────────────────────────────────────────
-- Does this project carry trial-produced work?
-- ────────────────────────────────────────────────────────────────────
--
-- The watermark question, answered server-side so the browser cannot talk
-- itself out of it. Note the last condition: buying Pro + AI lifts the
-- watermark from the estimate they ALREADY made. They keep the work, which
-- is a far better close than making them redo it.
create or replace function public.project_needs_ai_trial_watermark(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.jamie_loop_runs r
    join public.projects p on p.id = r.project_id
    where r.project_id = p_project_id
      and r.was_ai_trial
      and r.status = 'committed'
      and public.resolve_plan(p.user_id) is distinct from 'pro_ai'
  );
$function$;

revoke all on function public.project_needs_ai_trial_watermark(uuid) from public;
grant execute on function public.project_needs_ai_trial_watermark(uuid) to authenticated;
