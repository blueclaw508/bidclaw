// Pool / spa work detection — the single source of truth for the baby
// blue shading rule.
//
// HARD-WIRED BY DESIGN. Ian wants every pool job to read as a pool job
// at a glance, on screen and on paper, without anyone having to tag it.
// There is deliberately no setting, no per-user toggle, and no database
// column: the rule is the text of the job. If a lead's project name,
// description, or linked project name mentions pool work, it gets shaded.
//
// Every surface that renders a lead imports from here — Leads board
// cards, Leads list rows, and the 11x17 print report. Do not re-implement
// the keyword list anywhere else; add terms here and every surface picks
// them up.

import type { LeadListRow } from '@/lib/types'

/**
 * Pool-work vocabulary. Word-boundary anchored on purpose:
 *   • \bpool\b won't fire on "Liverpool" or "carpool"
 *   • \bspas?\b won't fire on "space", "Spanish", "sparse"
 *
 * Kept to terms that only ever mean pool/spa scope in this trade. Notably
 * absent: "coping", "liner", "deck", "water feature" — all of which show
 * up in masonry and hardscape jobs that have nothing to do with a pool.
 */
const POOL_TERMS =
  /\b(pools?|spas?|hot\s*tubs?|jacuzzis?|gunite|shotcrete|plunge|natatorium|pool\s*house)\b/i

/** Fields that describe the SCOPE. Contact name and town are excluded — a
 *  customer surnamed Poole is not a pool job. */
export function isPoolWork(lead: Pick<LeadListRow, 'project_name' | 'description' | 'project'>): boolean {
  const scope = [lead.project_name, lead.description, lead.project?.name]
    .filter(Boolean)
    .join(' ')
  return POOL_TERMS.test(scope)
}

/** Shading for a card-like container (board cards, mobile rows). */
export const POOL_CARD_CLASSES =
  'bg-brand-pool border-brand-pool-border'

/** Shading for a table row / list row — fill only, borders stay neutral. */
export const POOL_ROW_CLASSES = 'bg-brand-pool'

/** Small inline marker used where a legend would otherwise be needed. */
export const POOL_LEGEND = 'Baby blue = pool / spa work'
