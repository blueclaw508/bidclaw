// Proposal document defaults — the fallbacks a contractor inherits before
// they have customised anything, kept in ONE place so the settings form and
// the print view can never disagree about what "blank" means.

import type { CompanySettings, Proposal } from '@/lib/types'

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
