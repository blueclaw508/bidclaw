// The QuickCalc "Terms" card — up to five payment milestones, each with a
// description, a percent, and the dollar amount that percent works out to.
// Ian, 2026-09-04, pointing at QC's version: "I'm looking for this."
//
// ONE component drives both surfaces so they can never drift: My Numbers
// edits the company default (no proposal to price against, so `total` is
// null and the amount column is suppressed), the proposal editor edits this
// job's schedule against its real grand total.

import { CreditCard, Plus, Trash2 } from 'lucide-react'
import { formatUSD } from '@/lib/money'
import {
  MAX_PAYMENT_MILESTONES,
  milestoneAmounts,
  milestonePercentTotal,
} from '@/lib/proposalDefaults'
import type { PaymentMilestone } from '@/lib/types'

export function PaymentMilestonesEditor({
  value,
  onChange,
  total,
  disabled = false,
  subtitle,
}: {
  value: PaymentMilestone[]
  onChange: (next: PaymentMilestone[]) => void
  /**
   * Grand total to price the percentages against. NULL hides the amount
   * column — used by My Numbers, where the default schedule exists before
   * any job does.
   */
  total: number | null
  disabled?: boolean
  subtitle?: string
}) {
  const percentTotal = milestonePercentTotal(value)
  const amounts = total === null ? [] : milestoneAmounts(value, total)
  const atCap = value.length >= MAX_PAYMENT_MILESTONES
  // A schedule that doesn't add to 100% is the one error worth surfacing:
  // it means the client is being asked for more or less than the job costs.
  // Silent while empty — an untouched card is not a mistake.
  const offBy = value.length > 0 && percentTotal !== 100

  const patch = (index: number, next: Partial<PaymentMilestone>) => {
    onChange(value.map((m, i) => (i === index ? { ...m, ...next } : m)))
  }

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 px-6 py-4">
        <span className="rounded-lg bg-emerald-100 p-2">
          <CreditCard className="h-5 w-5 text-emerald-700" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-900">Terms</h2>
          <p className="text-xs text-gray-500">
            {subtitle ??
              `Define up to ${MAX_PAYMENT_MILESTONES} payment milestones`}
          </p>
        </div>
        {!disabled && !atCap ? (
          <button
            type="button"
            onClick={() => onChange([...value, { description: '', percent: 0 }])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            <Plus className="h-4 w-4" />
            Add Payment
          </button>
        ) : null}
      </header>

      <div className="px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <th className="w-8 py-2 text-left">#</th>
              <th className="py-2 text-left">Description</th>
              <th className="w-24 py-2 text-right">%</th>
              {total === null ? null : (
                <th className="w-32 py-2 text-right">Amount</th>
              )}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td
                  colSpan={total === null ? 4 : 5}
                  className="py-6 text-center text-sm text-gray-400"
                >
                  No payment milestones — the proposal prints your written
                  payment terms instead.
                </td>
              </tr>
            ) : (
              value.map((m, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-2.5 text-sm font-semibold text-emerald-700">
                    {i + 1}
                  </td>
                  <td className="py-2.5 pr-3">
                    <input
                      type="text"
                      value={m.description}
                      disabled={disabled}
                      onChange={(e) => patch(i, { description: e.target.value })}
                      placeholder={`Payment ${i + 1} (e.g., Upon signing, 50% complete...)`}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        // Empty renders as an empty box rather than a literal
                        // 0, so a fresh row reads like the placeholder does.
                        value={m.percent === 0 ? '' : m.percent}
                        disabled={disabled}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          patch(i, {
                            percent:
                              e.target.value === '' || !Number.isFinite(n)
                                ? 0
                                : n,
                          })
                        }}
                        className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-7 text-right text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        %
                      </span>
                    </div>
                  </td>
                  {total === null ? null : (
                    <td className="py-2.5 pr-3 text-right text-sm font-semibold text-gray-900 tabular-nums">
                      {formatUSD(amounts[i] ?? 0)}
                    </td>
                  )}
                  <td className="py-2.5 text-right">
                    {disabled ? null : (
                      <button
                        type="button"
                        aria-label={`Remove payment ${i + 1}`}
                        onClick={() =>
                          onChange(value.filter((_, idx) => idx !== i))
                        }
                        className="rounded p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {value.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-emerald-200">
                <td />
                <td className="py-3 text-sm font-bold text-gray-900">Total</td>
                <td
                  className={`py-3 pr-3 text-right text-sm font-bold tabular-nums ${
                    offBy ? 'text-amber-700' : 'text-gray-900'
                  }`}
                >
                  {percentTotal.toFixed(2)}%
                </td>
                {total === null ? null : (
                  <td className="py-3 pr-3 text-right text-sm font-bold text-emerald-700 tabular-nums">
                    {formatUSD(
                      amounts.reduce((sum, n) => sum + n, 0)
                    )}
                  </td>
                )}
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>

        {offBy ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            These milestones add to {percentTotal.toFixed(2)}%, not 100%. The
            client would be billed{' '}
            {percentTotal > 100 ? 'more' : 'less'} than the job price.
          </p>
        ) : null}

        {!disabled && !atCap ? (
          <button
            type="button"
            onClick={() => onChange([...value, { description: '', percent: 0 }])}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-emerald-300 py-2.5 text-sm font-medium text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50"
          >
            <Plus className="h-4 w-4" />
            Add Payment ({value.length}/{MAX_PAYMENT_MILESTONES})
          </button>
        ) : null}
        {atCap && !disabled ? (
          <p className="mt-3 text-center text-xs text-gray-400">
            {MAX_PAYMENT_MILESTONES} of {MAX_PAYMENT_MILESTONES} milestones —
            remove one to add another.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default PaymentMilestonesEditor
