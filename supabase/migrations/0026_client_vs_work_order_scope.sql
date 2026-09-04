-- JAMIE-FLOW §4 revision (Ian, 2026-09-04): the scope text used to do two
-- jobs at once — what the client is buying AND what the crew builds. One
-- text cannot serve both. A client holding the crew's version can count
-- lifts, loads and rebar and demand a redo or a credit when the crew builds
-- it a different, equally good way; and the crew's version names fees
-- ("six trailer loads with disposal fees"), which must never reach a client.
--
-- `description` keeps its meaning: the WORK ORDER scope (crew + estimator,
-- and the text the scope-vs-lines fail-safe reconciles against).
-- `client_description` is the PROPOSAL scope: plain language, headline
-- dimensions only, never a cost or a fee. NULL means "not written yet" and
-- every reader falls back to `description`, so existing work areas keep
-- printing exactly as they do today.

alter table work_areas
  add column if not exists client_description text;

comment on column work_areas.description is
  'WORK ORDER scope (JAMIE-FLOW 4b): step-by-step for the crew, full quantities, lifts, spec, machines, disposal. Shown on the Crew and Detailed prints. The scope-vs-lines fail-safe runs against this.';

comment on column work_areas.client_description is
  'CLIENT scope (JAMIE-FLOW 4a): proposal verbiage. Plain language, headline dimensions only (SF/LF/counts the client is buying), NEVER a cost, fee, lift count, bag/load count or rebar schedule. Shown on the Summary print. NULL = fall back to description.';

alter table jamie_proposed_work_areas
  add column if not exists proposed_client_description text;

comment on column jamie_proposed_work_areas.proposed_client_description is
  'Staged CLIENT scope from Pass 2 (JAMIE-FLOW 4a), committed to work_areas.client_description at Gate 2.';
