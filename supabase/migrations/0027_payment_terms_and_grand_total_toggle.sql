-- Ian, 2026-09-04. Two gaps in the proposal's customisable fields.
--
-- 1. Payment terms had a SHOW/HIDE toggle (pdf_show_payment_terms) but the
--    sentence itself was hardcoded in ProposalPrintView: "50% deposit upon
--    acceptance. Balance due upon project completion." A contractor could
--    turn the section off but never change what it said. NULL keeps that
--    exact sentence as the fallback, so nothing moves for anyone until
--    they edit it.
--
-- 2. No way to suppress the project total on a client proposal. Ian:
--    "I'd prefer not to total the proposals because the price changes if
--    they don't take all options." Work-area prices still print — that is
--    the point, so the client can pick options — but the grand total can
--    be withheld. Company default in settings, per-proposal override on
--    the proposal (NULL = inherit the company default).

alter table company_settings
  add column if not exists default_payment_terms text,
  add column if not exists pdf_show_grand_total boolean not null default true;

comment on column company_settings.default_payment_terms is
  'Payment terms text for the client proposal. NULL falls back to "50% deposit upon acceptance. Balance due upon project completion." Shown only when pdf_show_payment_terms is true.';

comment on column company_settings.pdf_show_grand_total is
  'Company default for printing a project total on the client proposal. Work-area prices always print; this governs the grand total only.';

alter table proposals
  add column if not exists show_grand_total boolean;

comment on column proposals.show_grand_total is
  'Per-proposal override of company_settings.pdf_show_grand_total. NULL = inherit the company default.';
