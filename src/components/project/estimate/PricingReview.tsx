import { useState } from 'react'
import { formatUSD } from '@/lib/money'
import { pricingComparison, reviewPricing, type PricingReviewLine } from '@/lib/pricingReview'

const labels: Record<string, string> = { labor: 'Labor', material: 'Materials', equipment: 'Equipment', subcontractor: 'Subcontractors', other: 'Other' }
const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Local comparison inputs only: no database writes and no changes to pricing. */
export function PricingReview({ lines }: { lines: PricingReviewLine[] }) {
  const [size, setSize] = useState('')
  const [unit, setUnit] = useState('SF')
  const [crew, setCrew] = useState('')
  const [day, setDay] = useState('')
  const [reference, setReference] = useState('')
  const review = reviewPricing(lines)
  const comparison = pricingComparison(review.total, review.personHours, size, crew, day, reference)
  if (!lines.length) return null
  const input = 'mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-base'
  return (
    <details className="m-3 rounded-lg border border-blue-200 bg-white p-3 text-base text-gray-800">
      <summary className="cursor-pointer font-semibold text-brand-navy">
        Check the pricing · {formatUSD(review.total)} · {number(review.personHours)} person-hours{review.unconvertedLabor > 0 ? ' + other labor units' : ''}
      </summary>
      <p className="mt-2 text-sm text-gray-600">Review only. These comparison inputs are temporary and never change your estimate or proposal.</p>
      <dl className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.entries(review.categories).map(([category, price]) => <div key={category}>
          <dt className="text-sm text-gray-600">{labels[category] ?? category} selling total</dt>
          <dd className="font-semibold">{formatUSD(price)}</dd>
        </div>)}
      </dl>
      {review.invalidPrices > 0 && <p role="alert">Some prices are incomplete. The displayed total excludes them.</p>}
      <p className="text-sm">Hourly labor is counted as person-hours. Labor rates may already include overhead and profit; this is not a wage-cost or margin report.</p>
      {review.unconvertedLabor > 0 && <p className="mt-2 text-sm text-amber-800">{review.unconvertedLabor} labor line(s) use days, lump sums, crew-hours, or unknown units. Their price is included, but their hours are excluded below.</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>Crew members<input type="number" min="1" step="1" value={crew} onChange={e => setCrew(e.target.value)} placeholder="Enter crew size" className={input} /></label>
        <label>Hours per person per day<input type="number" min="0.25" max="24" step="0.25" value={day} onChange={e => setDay(e.target.value)} placeholder="Enter working hours" className={input} /></label>
      </div>
      {comparison.crewDays !== null && <p className="mt-2 font-semibold">{number(review.personHours)} person-hours ÷ ({crew} people × {day} hours) = {number(comparison.crewDays)} equivalent crew-days.</p>}
      <p className="mt-1 text-sm text-gray-600">A scheduling comparison, not elapsed job duration. Different trades may work on different days.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>Measured scope quantity<input type="number" min="0.01" step="any" value={size} onChange={e => setSize(e.target.value)} placeholder="Your measurement" className={input} /></label>
        <label>Measurement unit<select className={input} value={unit} onChange={e => { setUnit(e.target.value); setReference('') }}><option>SF</option><option>LF</option><option>EA</option><option>CY</option></select></label>
      </div>
      <p className="mt-1 text-sm text-gray-600">Use the size for this entire work area. Material quantities may include waste and are not assumed to be the finished size.</p>
      {comparison.unitPrice !== null && <div className="mt-3 rounded bg-blue-50 p-3">
        <p className="font-semibold">{formatUSD(comparison.unitPrice)}/{unit} · {number(comparison.hoursPerUnit ?? 0)} person-hours/{unit}</p>
        <label className="mt-3 block">Your comparable selling price ($/{unit})<input type="number" min="0.01" step="any" value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional, same scope and method" className={input} /></label>
        {comparison.differencePercent !== null && <p className="mt-2 font-semibold">{number(Math.abs(comparison.differencePercent))}% {comparison.differencePercent >= 0 ? 'above' : 'below'} your comparison price.</p>}
        <p className="mt-1 text-sm">This compares against your entry, not a verified market rate. Check materials, access, preparation and inclusions before comparing jobs.</p>
      </div>}
      <h4 className="mt-4 font-semibold">Largest price contributors</h4>
      <p className="mt-1 text-sm text-gray-600">A catalog link does not confirm a current supplier quote. Missing source information is shown explicitly.</p>
      <ol className="mt-2 space-y-3">
        {review.largest.map(line => <li key={line.id} className="rounded border border-gray-200 p-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{line.label}</span><strong>{formatUSD(line.price)}</strong></div>
          <p className="mt-1 text-sm">{line.quantity ?? '?'} {line.unit || 'units'} × {line.unitCost === null ? 'unpriced' : formatUSD(line.unitCost)} per unit, before markup or total overrides.</p>
          <p className="mt-1 text-sm">{line.source}</p>
          {line.reasoning && <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Jamie's explanation</summary><p className="mt-1 whitespace-pre-wrap">{line.reasoning}</p></details>}
        </li>)}
      </ol>
    </details>
  )
}
