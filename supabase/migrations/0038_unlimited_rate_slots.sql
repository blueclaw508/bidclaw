-- 0038 — as many labor types and equipment rates as a contractor wants.
--
-- These were capped at 5 and 10 by CHECK constraints, inherited from the
-- KYN workbook's fixed rows. The cap is arbitrary the moment the numbers
-- come from the contractor rather than from a spreadsheet: Jovanne's KYN
-- model alone carries 12 pieces of equipment, so importing it would have
-- silently dropped two of them.
--
-- Ian, 2026-09-05: "The slots should be endless, as many as a user wants
-- to create."
--
-- slot_number stays, and stays UNIQUE per user — it is the display order
-- and the stable handle the form edits by. It is simply no longer bounded.
alter table public.company_labor_types
  drop constraint if exists company_labor_types_slot_number_check;

alter table public.company_equipment_rates
  drop constraint if exists company_equipment_rates_slot_number_check;

-- Still has to be a positive ordinal — a zero or negative slot is a bug,
-- not a preference.
alter table public.company_labor_types
  add constraint company_labor_types_slot_number_positive
  check (slot_number >= 1);

alter table public.company_equipment_rates
  add constraint company_equipment_rates_slot_number_positive
  check (slot_number >= 1);

-- handle_new_user still seeds 5 labor and 10 equipment rows. That is now a
-- STARTING SET rather than a ceiling: blank rows to type into, which a new
-- contractor needs, and they can add or delete freely from there.
--
-- Deleting is safe but not invisible: kit_lines references both tables with
-- ON DELETE SET NULL, so a removed rate unlinks any kit line that used it
-- while the line keeps its own stored rate. The UI counts those and says so
-- rather than letting a kit quietly price differently later.
