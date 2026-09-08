import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatUSD, roundMoney } from '@/lib/money'
import { formatDateOnly, todayIso } from '@/lib/invoiceStatus'
import { getQboConnection, pullCostsFromQbo, type QboConnection } from '@/lib/qbo'
import {
  assignJobCost,
  COST_CATEGORY_LABELS,
  COST_CATEGORY_ORDER,
  listJobCostsByProject,
  listUnassignedCostsForCustomer,
  projectCostSummary,
  setJobCostCategory,
  type CostSummary,
} from '@/lib/jobCosts'
import type { JobCost, JobCostCategory, Project } from '@/lib/types'

/**
 * Job Cost tab (roadmap step 5): what it was bid at, what it has cost,
 * by category, with the lines behind the number. Costs come from
 * QuickBooks; the estimate comes from the approved proposal.
 */
export default function JobCostTab({ project }: { project: Project }) {
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [costs, setCosts] = useState<JobCost[]>([])
  const [unassigned, setUnassigned] = useState<JobCost[]>([])
  const [qbo, setQbo] = useState<QboConnection | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [from, setFrom] = useState(project.created_at.slice(0, 10))
  const [to, setTo] = useState(todayIso())

  const load = useCallback(async () => {
    try {
      const [s, c, u, conn] = await Promise.all([
        projectCostSummary(project.id),
        listJobCostsByProject(project.id),
        project.customer_id ? listUnassignedCostsForCustomer(project.customer_id) : Promise.resolve([]),
        getQboConnection().catch(() => null),
      ])
      setSummary(s)
      setCosts(c)
      setUnassigned(u)
      setQbo(conn)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed.')
    }
  }, [project.id, project.customer_id])

  useEffect(() => {
    void load()
  }, [load])

  const pull = async () => {
    setBusy('pull')
    try {
      const res = await pullCostsFromQbo(from, to)
      toast.success(
        `Pulled ${res.lines} cost line${res.lines === 1 ? '' : 's'}: ${res.assigned} landed on projects, ${res.unassigned} need a home.`
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't pull from QuickBooks.")
    } finally {
      setBusy(null)
    }
  }

  const assign = async (row: JobCost, projectId: string | null) => {
    setBusy(row.id)
    try {
      await assignJobCost(row.id, projectId)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move that.")
    } finally {
      setBusy(null)
    }
  }

  const recategorize = async (row: JobCost, category: JobCostCategory) => {
    setBusy(row.id)
    try {
      await setJobCostCategory(row.id, category)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change that.")
    } finally {
      setBusy(null)
    }
  }

  const margin = useMemo(() => {
    if (!summary) return null
    const atEstimate = roundMoney(summary.contract - summary.estimatedTotal)
    const toDate = roundMoney(summary.contract - summary.actualTotal)
    return { atEstimate, toDate }
  }, [summary])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <BarChart3 className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Job cost</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Estimated cost from the proposal, actual cost from QuickBooks, by category. The loop Know
                Your Numbers is built around.
              </p>
            </div>
          </div>
          {qbo ? (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" aria-label="From" />
              <span className="text-xs text-gray-500">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" aria-label="To" />
              <button
                type="button"
                onClick={() => void pull()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2CA01C] bg-white px-3.5 py-2 text-sm font-semibold text-[#1f7a13] hover:bg-green-50 disabled:opacity-50"
              >
                {busy === 'pull' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Pull from QuickBooks
              </button>
            </div>
          ) : qbo === null ? (
            <p className="text-xs text-gray-500">
              <Link to="/app/settings" className="font-semibold text-blue-700 hover:underline">
                Connect QuickBooks
              </Link>{' '}
              to pull actual costs.
            </p>
          ) : null}
        </div>
        {qbo?.last_sync_at ? (
          <p className="mt-2 text-[11px] text-gray-500">
            The pull covers every project at once: bills, checks and card charges coded to a customer or job in
            QuickBooks. Last sync {formatDateOnly(qbo.last_sync_at.slice(0, 10))}.
          </p>
        ) : null}
      </section>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      {summary && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Estimated cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actual to date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Variance</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {COST_CATEGORY_ORDER.map((cat) => {
                  const est = summary.estimated[cat]
                  const act = summary.actual[cat]
                  const v = roundMoney(est - act)
                  return (
                    <tr key={cat}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{COST_CATEGORY_LABELS[cat]}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatUSD(est)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{formatUSD(act)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${v < 0 ? 'text-rose-700' : v > 0 ? 'text-emerald-700' : 'text-gray-500'}`}>
                        {v < 0 ? `(${formatUSD(-v)})` : formatUSD(v)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                        {est > 0 ? `${Math.round((act / est) * 100)}%` : act > 0 ? '—' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <td className="px-4 py-2.5">Total cost</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatUSD(summary.estimatedTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatUSD(summary.actualTotal)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${summary.estimatedTotal - summary.actualTotal < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {(() => {
                      const v = roundMoney(summary.estimatedTotal - summary.actualTotal)
                      return v < 0 ? `(${formatUSD(-v)})` : formatUSD(v)
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {summary.estimatedTotal > 0 ? `${Math.round((summary.actualTotal / summary.estimatedTotal) * 100)}%` : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Contract" value={formatUSD(summary.contract)} hint={summary.proposal ? `${summary.proposal.name} (${summary.proposal.status.replace('_', ' ')})` : 'No proposal yet'} />
            <Stat label="Margin at estimate" value={margin ? formatUSD(margin.atEstimate) : '—'} hint={summary.contract > 0 && margin ? `${Math.round((margin.atEstimate / summary.contract) * 100)}% of contract` : undefined} />
            <Stat label="Margin to date" value={margin ? formatUSD(margin.toDate) : '—'} hint="Contract less actual cost so far" tone={margin && margin.toDate < (margin.atEstimate ?? 0) ? 'amber' : undefined} />
            <Stat label="Cost lines" value={String(costs.length)} hint={costs.length ? `latest ${formatDateOnly(costs[0].txn_date)}` : 'nothing pulled yet'} />
          </dl>
          {summary.proposal && summary.proposal.status !== 'approved' && summary.proposal.status !== 'in_progress' && summary.proposal.status !== 'completed' && (
            <p className="text-xs text-amber-700">
              No approved proposal on this project; the estimate column comes from “{summary.proposal.name}” ({summary.proposal.status.replace('_', ' ')}).
            </p>
          )}
        </>
      )}

      {/* Lines */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">Cost lines on this project</h3>
        </div>
        {costs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">
            {qbo ? 'Nothing landed here yet. Pull a date range above, or assign lines from the customer below.' : 'Connect QuickBooks in Settings, then pull a date range.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Vendor</th>
                  <th className="px-4 py-2 text-left font-semibold">Account</th>
                  <th className="px-4 py-2 text-left font-semibold">Category</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {costs.map((c) => (
                  <tr key={c.id} className="text-gray-800">
                    <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(c.txn_date)}</td>
                    <td className="px-4 py-2">
                      {c.vendor_name ?? '—'}
                      {c.description ? <span className="block truncate text-xs text-gray-500">{c.description}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{c.account_name ?? c.qbo_txn_type}</td>
                    <td className="px-4 py-2">
                      <select
                        value={c.category}
                        onChange={(e) => void recategorize(c, e.target.value as JobCostCategory)}
                        disabled={busy === c.id}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
                        aria-label="Category"
                      >
                        {COST_CATEGORY_ORDER.map((k) => (
                          <option key={k} value={k}>
                            {COST_CATEGORY_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatUSD(c.amount)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void assign(c, null)}
                        disabled={busy === c.id}
                        className="text-xs text-gray-400 hover:text-rose-600"
                        title="Not this project"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Unassigned for this customer */}
      {unassigned.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm">
          <div className="border-b border-amber-100 px-5 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">
              Coded to this customer, not yet on a project
            </h3>
            <p className="mt-0.5 text-xs text-amber-800">
              QuickBooks knew the customer but not which of their projects. Assign the ones that belong here.
            </p>
          </div>
          <ul className="divide-y divide-amber-100">
            {unassigned.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm text-gray-800">
                <span className="w-24 text-gray-600">{formatDateOnly(c.txn_date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {c.vendor_name ?? '—'} · {c.account_name ?? c.qbo_txn_type}
                  {c.description ? <span className="text-gray-500"> · {c.description}</span> : null}
                </span>
                <span className="tabular-nums font-semibold">{formatUSD(c.amount)}</span>
                <button
                  type="button"
                  onClick={() => void assign(c, project.id)}
                  disabled={busy === c.id}
                  className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
                >
                  Assign here
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'amber' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</dd>
      {hint ? <p className="truncate text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  )
}
