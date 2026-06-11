import { formatUSD, lineBase, lineMarkup } from '@/lib/money'
import { PROPOSAL_LINE_CATEGORY_LABELS } from '@/lib/statusConfig'
import type { ProposalTotals } from '@/lib/proposals'
import type { ProposalLineCategory, ProposalWithWorkAreas } from '@/lib/types'

/**
 * Totals breakdown card — per-category Base / Markup / Total table +
 * grand total. Extracted from ProposalEditor (P1-D cleanup 3).
 *
 * Rollup is computed from line-level data; only ENABLED work areas
 * contribute (disabled work areas still show their own subtotals on
 * their cards but are excluded from the grand total — architecture
 * decision locked at Phase 2c).
 *
 * Category visibility is by LINE COUNT, not dollars (P1-D cleanup 1
 * falsy-zero fix): a category whose lines are all $0 (unpriced yet)
 * must still show — hiding it made present-but-unpriced work invisible.
 */
export function TotalsBreakdown({
  totals,
  proposal,
}: {
  totals: ProposalTotals
  proposal: ProposalWithWorkAreas
}) {
  const rollup: Record<ProposalLineCategory, { base: number; markup: number; count: number }> = {
    labor: { base: 0, markup: 0, count: 0 },
    material: { base: 0, markup: 0, count: 0 },
    equipment: { base: 0, markup: 0, count: 0 },
    subcontractor: { base: 0, markup: 0, count: 0 },
    other: { base: 0, markup: 0, count: 0 },
  }
  for (const wa of proposal.work_areas) {
    if (!wa.enabled) continue
    for (const l of wa.lines) {
      rollup[l.category].base += lineBase(l)
      rollup[l.category].markup += lineMarkup(l)
      rollup[l.category].count += 1
    }
  }

  const visibleCategories = (Object.keys(rollup) as ProposalLineCategory[]).filter(
    (cat) => rollup[cat].count > 0
  )

  if (visibleCategories.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 bg-slate-50 px-4 py-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Proposal total
          </h3>
        </header>
        <div className="px-4 py-6 text-center text-xs italic text-gray-400">
          No line items yet.
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <header className="border-b border-gray-100 bg-slate-50 px-4 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          Proposal total
        </h3>
      </header>

      {/* Desktop tabular layout — Base / Markup / Total columns */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2 text-left font-semibold">Category</th>
            <th className="px-4 py-2 text-right font-semibold">Base</th>
            <th className="px-4 py-2 text-right font-semibold">Markup</th>
            <th className="px-4 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visibleCategories.map((cat) => {
            const { base, markup } = rollup[cat]
            return (
              <tr key={cat}>
                <td className="px-4 py-2 font-medium text-gray-700">
                  {PROPOSAL_LINE_CATEGORY_LABELS[cat]}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatUSD(base)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                  {markup > 0 ? `+ ${formatUSD(markup)}` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {formatUSD(base + markup)}
                </td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-gray-200 bg-brand-navy/5">
            <td colSpan={3} className="px-4 py-3 text-base font-bold text-gray-900">
              GRAND TOTAL
            </td>
            <td className="px-4 py-3 text-right text-lg font-bold tabular-nums text-brand-navy">
              {formatUSD(totals.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Mobile stacked layout — per-category card with Base / Markup / Total dl */}
      <div className="space-y-3 px-4 py-3 sm:hidden">
        {visibleCategories.map((cat) => {
          const { base, markup } = rollup[cat]
          return (
            <div
              key={cat}
              className="rounded-lg border border-gray-100 p-3"
            >
              <div className="text-sm font-semibold text-gray-900">
                {PROPOSAL_LINE_CATEGORY_LABELS[cat]}
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Base</dt>
                  <dd className="tabular-nums text-gray-900">{formatUSD(base)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Markup</dt>
                  <dd className="tabular-nums text-gray-700">
                    {markup > 0 ? `+ ${formatUSD(markup)}` : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-1">
                  <dt className="font-semibold text-gray-700">Total</dt>
                  <dd className="font-semibold tabular-nums text-gray-900">
                    = {formatUSD(base + markup)}
                  </dd>
                </div>
              </dl>
            </div>
          )
        })}
        <div className="flex items-center justify-between rounded-lg bg-brand-navy/5 p-3">
          <span className="text-base font-bold text-gray-900">GRAND TOTAL</span>
          <span className="text-lg font-bold tabular-nums text-brand-navy">
            {formatUSD(totals.grandTotal)}
          </span>
        </div>
      </div>
    </div>
  )
}
