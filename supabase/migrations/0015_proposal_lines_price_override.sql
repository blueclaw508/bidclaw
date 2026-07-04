-- 0015 — proposal_lines.price_override (R4).
-- Applied to prod via Supabase MCP on 2026-07-04.
-- Estimate lines carry QC-style price overrides; generation must
-- reproduce the overridden total exactly on the frozen side. NULL =
-- computed pricing (qty x cost x (1 + markup/100)); non-null = this
-- line's customer-facing total is exactly this value.
-- money.ts lineTotal/lineMarkup are override-aware: for overridden
-- lines, markup dollars display as (override - base) so the
-- base + markup = total invariant holds everywhere.
ALTER TABLE public.proposal_lines
  ADD COLUMN price_override numeric NULL CHECK (price_override >= 0);
