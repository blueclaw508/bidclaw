-- Ian, 2026-09-04: "where do i enter the terms for this project?"
-- Nowhere, until now. Only company_settings.default_terms_and_conditions
-- existed, printed on every proposal. Worse, the My Numbers card told the
-- contractor "You can still edit them per-proposal on the Create Proposal
-- page" — a control that has never existed. ProposalPrintView's own header
-- listed "Custom per-proposal terms" as deferred.
--
-- NULL inherits the company default, so every existing proposal prints
-- exactly what it prints today. A value here replaces the default for this
-- proposal only — the job with the unusual access clause, the HOA rider,
-- the winter-shutdown caveat.

alter table proposals
  add column if not exists terms_and_conditions text;

comment on column proposals.terms_and_conditions is
  'Terms & Conditions for THIS proposal. NULL inherits company_settings.default_terms_and_conditions. Shown only when company_settings.pdf_show_terms_and_conditions is true.';
