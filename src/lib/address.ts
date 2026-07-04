// Split-address helpers (R5, QC fidelity). Mirrors QC's
// formatAddress/formatAddressSingleLine semantics: structured
// Line1/City/State/Zip fields, blank parts omitted gracefully.
//
// Migration 0013 added split columns to customers (billing + site) and
// projects (site). The legacy freeform columns stay dormant as
// fallbacks so pre-R5 data still displays until re-entered.

export interface SplitAddress {
  line1: string | null
  city: string | null
  state: string | null
  zip: string | null
}

/** Any split field populated? */
export function hasSplitAddress(a: SplitAddress): boolean {
  return Boolean(a.line1?.trim() || a.city?.trim() || a.state?.trim() || a.zip?.trim())
}

/**
 * "line1\ncity, ST zip" with blank parts omitted (QC's formatAddress).
 * Returns '' when every part is blank.
 */
export function formatAddress(a: SplitAddress): string {
  const parts: string[] = []
  if (a.line1?.trim()) parts.push(a.line1.trim())
  const stateZip = [a.state?.trim(), a.zip?.trim()].filter(Boolean).join(' ')
  const city = a.city?.trim()
  if (city && stateZip) parts.push(`${city}, ${stateZip}`)
  else if (city) parts.push(city)
  else if (stateZip) parts.push(stateZip)
  return parts.join('\n')
}

/** Single-line variant for compact displays + Maps queries. */
export function formatAddressSingleLine(a: SplitAddress): string {
  return formatAddress(a).replace(/\n/g, ', ')
}

/**
 * Display resolution with legacy fallback: split fields win when any
 * is present; otherwise the legacy freeform string; otherwise ''.
 */
export function resolveAddress(a: SplitAddress, legacyFreeform: string | null): string {
  if (hasSplitAddress(a)) return formatAddress(a)
  return legacyFreeform?.trim() ?? ''
}

/** Google Maps search URL for a display address ('' → null). */
export function mapsUrl(displayAddress: string): string | null {
  const q = displayAddress.replace(/\n/g, ', ').trim()
  if (!q) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
