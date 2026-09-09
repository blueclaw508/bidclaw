/** Display-only inspection. Prices are supplied by the caller's existing money rules. */
export interface PricingReviewLine {
  id: string
  label: string
  category: string
  unit: string | null
  quantity: number | null
  unitCost: number | null
  price: number
  source: string
  reasoning?: string | null
}

export function positiveNumber(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function reviewPricing(lines: readonly PricingReviewLine[]) {
  const categories: Record<string, number> = {}
  let personHours = 0
  let unconvertedLabor = 0
  let invalidPrices = 0
  for (const line of lines) {
    if (Number.isFinite(line.price)) categories[line.category] = (categories[line.category] ?? 0) + line.price
    else invalidPrices++
    if (line.category !== 'labor') continue
    const unit = (line.unit ?? '').trim().toLowerCase()
    if (['hr', 'hrs', 'hour', 'hours', 'person-hour', 'person-hours'].includes(unit)
      && line.quantity !== null && Number.isFinite(line.quantity) && line.quantity >= 0) {
      personHours += line.quantity
    } else unconvertedLabor++
  }
  return {
    categories,
    total: Object.values(categories).reduce((sum, price) => sum + price, 0),
    personHours,
    unconvertedLabor,
    invalidPrices,
    largest: [...lines].filter(line => Number.isFinite(line.price)).sort((a, b) => b.price - a.price).slice(0, 5),
  }
}

export function pricingComparison(total: number, personHours: number, size: string, crew: string, day: string, reference: string) {
  const quantity = positiveNumber(size)
  const people = positiveNumber(crew)
  const hours = positiveNumber(day)
  const benchmark = positiveNumber(reference)
  const unitPrice = quantity && Number.isFinite(total) ? total / quantity : null
  return {
    unitPrice,
    hoursPerUnit: quantity ? personHours / quantity : null,
    crewDays: people && Number.isInteger(people) && hours && hours <= 24 ? personHours / (people * hours) : null,
    differencePercent: unitPrice !== null && benchmark ? (unitPrice / benchmark - 1) * 100 : null,
  }
}
