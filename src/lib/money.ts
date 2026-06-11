// src/lib/money.ts — THE money module (P1-D cleanup 2, LOOP.md).
//
// Single source of truth for proposal line math and USD formatting.
// Before this module the same three lines of arithmetic lived in 8+
// places (data layer aggregations, editor totals, print view, kit
// preview, line rows) and the markup-bearing category rule in 5.
// Jamie (Phase 2) consumes THESE helpers — she must never become
// another copy of the money math.
//
// The formula (KYN, frozen-snapshot architecture):
//   base   = quantity × frozen_unit_cost      (frozen_unit_cost is
//            canonical for ALL calculation — rates were copied into it
//            at insert time)
//   markup = base × frozen_markup_percent / 100
//   total  = base + markup                    (the customer-facing number)
//
// Non-finite inputs (NaN from a mid-edit draft state) contribute $0
// rather than poisoning an aggregate — matches the strictest of the
// pre-consolidation copies (ProposalLineRow.computePrice). DB-sourced
// rows are always finite (NOT NULL numeric columns), so this guard
// only affects transient UI draft states.

import type { ProposalLineCategory } from '@/lib/types'

/**
 * Minimal shape the math needs. Structural, so it accepts ProposalLine,
 * KitPreviewLine, and the lean aggregate rows the data layer selects.
 */
export interface MoneyLine {
  quantity: number | string
  frozen_unit_cost: number | string
  frozen_markup_percent: number | string
}

/** Pre-markup line amount: quantity × frozen_unit_cost. */
export function lineBase(line: MoneyLine): number {
  const q = Number(line.quantity)
  const c = Number(line.frozen_unit_cost)
  if (!Number.isFinite(q) || !Number.isFinite(c)) return 0
  return q * c
}

/** Markup dollars on a line: base × frozen_markup_percent / 100. */
export function lineMarkup(line: MoneyLine): number {
  const m = Number(line.frozen_markup_percent)
  if (!Number.isFinite(m)) return 0
  return lineBase(line) * (m / 100)
}

/**
 * Customer-facing line total: base + markup. Returns 0 when ANY input
 * is non-finite (a half-typed line prices as $0, never NaN).
 */
export function lineTotal(line: MoneyLine): number {
  const q = Number(line.quantity)
  const c = Number(line.frozen_unit_cost)
  const m = Number(line.frozen_markup_percent)
  if (!Number.isFinite(q) || !Number.isFinite(c) || !Number.isFinite(m)) return 0
  return q * c * (1 + m / 100)
}

/**
 * The markup-bearing category rule (KYN): material / subcontractor /
 * other carry markup; labor + equipment are fixed at 0 because their
 * rates already include margin. Drives editability, validation, and
 * which totals rows show a markup column.
 */
export function categoryBearsMarkup(
  cat: ProposalLineCategory
): cat is 'material' | 'subcontractor' | 'other' {
  return cat === 'material' || cat === 'subcontractor' || cat === 'other'
}

/** USD formatter for all proposal money. Non-finite → "$0.00". */
export function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
