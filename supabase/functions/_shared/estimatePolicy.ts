/** Generated allowances are opt-in: the contractor adds these manually. */
export function isAutomaticAllowance(label: string): boolean {
  return /\bgeneral\s+conditions?\b|\brounding\b|\bincidentals?\b/i.test(label)
}

export function excludeAutomaticAllowances<T extends { label?: string; name?: string }>(lines: T[]): T[] {
  return lines.filter((line) => !isAutomaticAllowance(line.label ?? line.name ?? ''))
}

/** Approval of a takeoff does not imply confirmation of an unknown price. */
export function priceNeedsConfirmation(needsPricing: boolean, confirmed: boolean | undefined): boolean {
  return needsPricing && confirmed !== true
}
