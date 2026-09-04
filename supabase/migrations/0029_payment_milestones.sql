-- Ian, 2026-09-04, pointing at QuickCalc's Terms card: "I'm looking for
-- this." QC lets a contractor define up to five payment milestones —
-- description, percent, and the dollar amount that percent works out to —
-- with a total row that proves the schedule adds to 100%. BidClaw had one
-- free-text paragraph, so a deposit/progress/final schedule had to be
-- retyped in prose on every job and the arithmetic done in the estimator's
-- head. Standing rule: fidelity to QuickCalc once we get to the proposal.
--
-- Same shape as the terms columns beside them: a company default in My
-- Numbers, a per-proposal override, NULL = inherit. Percentages are stored,
-- not dollars — the amounts recompute from whatever the proposal totals, so
-- editing a line never leaves a stale payment schedule behind.
--
-- Shape (both columns): [{"description": "text", "percent": 50}, ...]

alter table company_settings
  add column if not exists default_payment_milestones jsonb;

alter table proposals
  add column if not exists payment_milestones jsonb;

-- Cheap structural guard. The app validates descriptions and percentages;
-- this only stops a non-array or a sixth row reaching the column, which no
-- amount of client-side care can rule out.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_default_payment_milestones_shape'
  ) then
    alter table company_settings
      add constraint company_settings_default_payment_milestones_shape
      check (
        default_payment_milestones is null
        or (jsonb_typeof(default_payment_milestones) = 'array'
            and jsonb_array_length(default_payment_milestones) <= 5)
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'proposals_payment_milestones_shape'
  ) then
    alter table proposals
      add constraint proposals_payment_milestones_shape
      check (
        payment_milestones is null
        or (jsonb_typeof(payment_milestones) = 'array'
            and jsonb_array_length(payment_milestones) <= 5)
      );
  end if;
end $$;

comment on column company_settings.default_payment_milestones is
  'Default payment schedule: JSON array of up to 5 {description, percent}. NULL falls back to the built-in 50/50 schedule. Dollar amounts are derived from each proposal total, never stored.';

comment on column proposals.payment_milestones is
  'Payment schedule for THIS proposal: JSON array of up to 5 {description, percent}. NULL inherits company_settings.default_payment_milestones.';
