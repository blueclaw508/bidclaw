/** Generated allowances are opt-in: the contractor adds these manually. */
export function isAutomaticAllowance(label: string): boolean {
  return /\bgeneral\s+conditions?\b|\brounding\b|\bincidentals?\b/i.test(label)
}

export function excludeAutomaticAllowances<T extends { label?: string; name?: string }>(lines: T[]): T[] {
  return lines.filter((line) => !isAutomaticAllowance(line.label ?? line.name ?? ''))
}

/** AI sometimes leaves a removed item behind with quantity zero. It is not work. */
export function prepareGeneratedTakeoff<T extends { label?: string; name?: string; qty: number }>(lines: T[]): T[] {
  return excludeAutomaticAllowances(lines).filter(line => Number.isFinite(line.qty) && line.qty > 0)
}

/** Approval of a takeoff does not imply confirmation of an unknown price. */
export function priceNeedsConfirmation(needsPricing: boolean, confirmed: boolean | undefined): boolean {
  return needsPricing && confirmed !== true
}

/** A single-area response with open questions is a clarification, not a takeoff. */
export function prepareSingleAreaResult<T extends { gap_questions: string[]; line_items: Array<{name: string; qty: number}> }>(result: T): T {
  const questions = result.gap_questions.filter(q => q.trim())
  return { ...result, gap_questions: questions, line_items: questions.length ? [] : prepareGeneratedTakeoff(result.line_items) }
}

export function canApplySingleAreaResult(result: { gap_questions: string[]; line_items: Array<{qty: number; unit_cost: number}> } | null): boolean {
  return !!result && result.gap_questions.length === 0 && result.line_items.length > 0 &&
    result.line_items.every(l => Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.unit_cost) && l.unit_cost > 0)
}

/** Shared by both estimating entry points so their labor assumptions agree. */
export const LABOR_BASIS_RULES = `LABOR BASIS:
Estimate person-hours by task and labor role. Show measured quantity x person-hours per unit = person-hours, or the contractor's explicit worker count x hours per worker. State whether each production factor comes from this job's instructions, a matching company kit, or an unverified estimating assumption.
Never assume a fixed crew size or shift length. Never round labor up to a half-day or full-day minimum unless the contractor explicitly supplies that minimum for this job. Do not apply a minimum separately to every work area when it is a shared crew shift.
Person-hours are not elapsed hours. Describe elapsed duration only when worker counts and scheduling are known; one mason for 6 hours plus one helper for 6 hours is 12 person-hours, not a 12-hour shift.
Build a task ledger before totaling labor. Each task must identify its role, measured quantity, factor and included operations. A total-person-hour kit factor already covers the crew; do not multiply it by crew size or repeat it for each role. Split that total by role only when the allocation is known. If the kit's basis is ambiguous, ask.
Do not duplicate preparation, material handling, equipment operation, planting watering or cleanup already included in another task factor. Setup and final cleanup are shared once across the batch unless separate visits are confirmed. Equipment rental hours do not create an additional operator allowance when operation is already in the labor line.
Use method-matched factors: repair/relay is not new construction, hand carrying is not machine spreading, and a small planting is not a large field installation. Explain a site adjustment and its added hours separately; never silently stack generic difficulty percentages. A supplied total labor budget for the whole job must reconcile across all work areas, not be repeated in each area.
Use the contractor's selling labor and equipment rates unchanged, with no extra markup. Equipment hours follow actual use, not automatically total person-hours.
Do not transfer a one-job quantity correction into a universal production factor. Preserve this job's exclusions, client-supplied materials and approved methods.
Before returning a takeoff, reconcile every labor quantity, line explanation, crew instruction and stated total. Flag assumed production factors for review; do not present them as verified company performance.`
