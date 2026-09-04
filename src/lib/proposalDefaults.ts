// Proposal document defaults — the fallbacks a contractor inherits before
// they have customised anything, kept in ONE place so the settings form and
// the print view can never disagree about what "blank" means.

import { roundMoney } from '@/lib/money'
import type { CompanySettings, PaymentMilestone, Proposal } from '@/lib/types'

/**
 * What the PAYMENT TERMS section said before it was editable. It was
 * hardcoded in ProposalPrintView, so every contractor printed this exact
 * sentence with no way to change it. It stays the fallback rather than
 * becoming a blank section, so upgrading changes nothing until a
 * contractor deliberately edits it.
 */
export const DEFAULT_PAYMENT_TERMS =
  '50% deposit upon acceptance. Balance due upon project completion.'

/** The payment terms to print: the contractor's text, else the original. */
export function resolvePaymentTerms(
  settings: Pick<CompanySettings, 'default_payment_terms'>
): string {
  return settings.default_payment_terms?.trim() || DEFAULT_PAYMENT_TERMS
}

/**
 * The Terms & Conditions to print: this proposal's own text when set,
 * otherwise the company default. Visibility is still governed by
 * `pdf_show_terms_and_conditions`.
 */
export function resolveTerms(
  proposal: Pick<Proposal, 'terms_and_conditions'> | null | undefined,
  settings: Pick<CompanySettings, 'default_terms_and_conditions'> | null | undefined
): string {
  return (
    proposal?.terms_and_conditions?.trim() ||
    settings?.default_terms_and_conditions?.trim() ||
    ''
  )
}

/**
 * Whether this proposal prints a PROJECT TOTAL.
 *
 * Per-proposal wins; NULL inherits the company default. Ian, 2026-09-04:
 * "I'd prefer not to total the proposals because the price changes if they
 * don't take all options." Work-area prices always print — that is what
 * lets a client pick — but a grand total across options they have not
 * committed to is a number that stops being true the moment they drop one.
 */
export function showsGrandTotal(
  proposal: Pick<Proposal, 'show_grand_total'> | null | undefined,
  settings: Pick<CompanySettings, 'pdf_show_grand_total'> | null | undefined
): boolean {
  if (proposal?.show_grand_total !== null && proposal?.show_grand_total !== undefined) {
    return proposal.show_grand_total
  }
  return settings?.pdf_show_grand_total ?? true
}

// ──────────────────────────────────────────────────────────────────────
// Payment milestones (QC parity — 0029)
// ──────────────────────────────────────────────────────────────────────

/**
 * QuickCalc's cap, matched deliberately. Five rows covers deposit /
 * mobilisation / two progress draws / final; past that a payment schedule
 * belongs in the contract body, not a summary table on page one.
 */
export const MAX_PAYMENT_MILESTONES = 5

/**
 * The schedule a contractor inherits before customising anything — the
 * same split DEFAULT_PAYMENT_TERMS states in prose, so turning the
 * paragraph into a table changes the presentation and not the deal.
 */
export const DEFAULT_PAYMENT_MILESTONES: PaymentMilestone[] = [
  { description: 'Deposit upon acceptance', percent: 50 },
  { description: 'Balance upon completion', percent: 50 },
]

/**
 * Coerce a jsonb column into milestones. The column is free-form JSON, so
 * anything could be in it: a hand-run SQL update, a row written by an older
 * build, a percent stored as a string. Rows that carry neither a
 * description nor a usable percent are dropped rather than rendered as a
 * blank line on a client document.
 */
export function parsePaymentMilestones(raw: unknown): PaymentMilestone[] {
  if (!Array.isArray(raw)) return []
  const out: PaymentMilestone[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const description = typeof rec.description === 'string' ? rec.description : ''
    const percent = Number(rec.percent)
    const safePercent = Number.isFinite(percent) ? percent : 0
    if (!description.trim() && safePercent === 0) continue
    out.push({ description, percent: safePercent })
    if (out.length === MAX_PAYMENT_MILESTONES) break
  }
  return out
}

/**
 * The payment schedule to print: this proposal's own when it has one,
 * else the company default, else the built-in 50/50. Mirrors resolveTerms
 * so the two halves of the closing page inherit by the same rule.
 */
export function resolvePaymentMilestones(
  proposal: Pick<Proposal, 'payment_milestones'> | null | undefined,
  settings: Pick<CompanySettings, 'default_payment_milestones'> | null | undefined
): PaymentMilestone[] {
  const own = parsePaymentMilestones(proposal?.payment_milestones)
  if (own.length > 0) return own
  const company = parsePaymentMilestones(settings?.default_payment_milestones)
  if (company.length > 0) return company
  return DEFAULT_PAYMENT_MILESTONES
}

/** Sum of the percent column, rounded like money so 33.33 × 3 reads 99.99. */
export function milestonePercentTotal(milestones: PaymentMilestone[]): number {
  return roundMoney(
    milestones.reduce(
      (sum, m) => sum + (Number.isFinite(m.percent) ? m.percent : 0),
      0
    )
  )
}

/**
 * Dollar amount for each milestone, in order.
 *
 * The parts must add to the whole (money is cents — see money.ts). Rounding
 * each percentage independently does not guarantee that: a 33.33/33.33/33.34
 * split of $100,000 rounds to three amounts summing a cent off. So the final
 * row absorbs the residual — but ONLY when the schedule actually claims to
 * be the entire job (100%). A schedule totalling 90% is either mid-edit or
 * deliberately partial; silently fattening its last row to cover the missing
 * 10% would invent a payment the contractor never wrote.
 */
export function milestoneAmounts(
  milestones: PaymentMilestone[],
  total: number
): number[] {
  const safeTotal = Number.isFinite(total) ? total : 0
  const amounts = milestones.map((m) =>
    roundMoney((safeTotal * (Number.isFinite(m.percent) ? m.percent : 0)) / 100)
  )
  if (amounts.length === 0) return amounts
  if (milestonePercentTotal(milestones) !== 100) return amounts
  const residual = roundMoney(
    safeTotal - amounts.reduce((sum, n) => sum + n, 0)
  )
  amounts[amounts.length - 1] = roundMoney(
    amounts[amounts.length - 1] + residual
  )
  return amounts
}

/**
 * Are these two schedules the same? Used to decide whether a proposal is
 * still INHERITING its company default (store NULL) or has genuinely
 * diverged (store the rows). Without it, opening a proposal and saving
 * anything would freeze a private copy of the default, and later edits in
 * My Numbers would silently stop reaching it.
 */
export function sameMilestones(
  a: PaymentMilestone[],
  b: PaymentMilestone[]
): boolean {
  if (a.length !== b.length) return false
  return a.every(
    (m, i) =>
      m.description.trim() === b[i].description.trim() &&
      roundMoney(m.percent) === roundMoney(b[i].percent)
  )
}
