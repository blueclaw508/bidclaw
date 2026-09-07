import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Loader2, Lock, RefreshCw, Send, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatUSD, roundMoney, sumMoney } from '@/lib/money'
import { formatDateOnly } from '@/lib/invoiceStatus'
import { getQboConnection, postWipToQbo, type QboConnection } from '@/lib/qbo'
import {
  closePeriod,
  getPeriod,
  isPeriodClosedError,
  monthEnd,
  monthEndOf,
  periodLabel,
  reopenPeriod,
  setPercentComplete,
  snapshotPeriod,
  type WipEntryRow,
} from '@/lib/wip'
import type { WipPeriod } from '@/lib/types'

/**
 * Month-end WIP (roadmap step 4). Pick a month, enter percent complete
 * per work area, read the over/under billing, close the month, post the
 * entry to QuickBooks. Contract values and billings come from live data
 * every time the page opens or Refresh is pressed; percents are yours.
 */
export default function WipPage() {
  const [month, setMonth] = useState(() => monthEnd(new Date()).slice(0, 7))
  const periodEnd = useMemo(() => monthEndOf(month), [month])
  const [period, setPeriod] = useState<WipPeriod | null>(null)
  const [entries, setEntries] = useState<WipEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [qbo, setQbo] = useState<QboConnection | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async (refresh = true) => {
    try {
      const id = refresh ? await snapshotPeriod(periodEnd) : null
      const res = id ? await getPeriod(id) : null
      if (!res) throw new Error('Could not open that month.')
      setPeriod(res.period)
      setEntries(res.entries)
      setDrafts({})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed.')
    } finally {
      setLoading(false)
    }
  }, [periodEnd])

  useEffect(() => {
    setLoading(true)
    void load()
    getQboConnection().then(setQbo).catch(() => setQbo(null))
  }, [load])

  const closed = period?.status === 'closed'

  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; rows: WipEntryRow[] }>()
    for (const e of entries) {
      const g = map.get(e.project_id) ?? { name: e.project_name, rows: [] }
      g.rows.push(e)
      map.set(e.project_id, g)
    }
    return [...map.entries()].map(([id, g]) => ({ id, ...g }))
  }, [entries])

  const totals = useMemo(() => {
    const contract = sumMoney(entries.map((e) => e.contract_value))
    const earned = sumMoney(entries.map((e) => e.earned))
    const billed = sumMoney(entries.map((e) => e.billed_to_date))
    const over = sumMoney(entries.filter((e) => e.over_under > 0).map((e) => e.over_under))
    const under = sumMoney(entries.filter((e) => e.over_under < 0).map((e) => -e.over_under))
    return { contract, earned, billed, over, under }
  }, [entries])

  const commitPercent = async (row: WipEntryRow) => {
    const raw = drafts[row.id]
    if (raw === undefined) return
    const pct = Number(raw)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error('Percent complete is 0 to 100.')
      setDrafts((d) => ({ ...d, [row.id]: String(row.percent_complete) }))
      return
    }
    if (roundMoney(pct) === row.percent_complete) {
      setDrafts((d) => {
        const n = { ...d }
        delete n[row.id]
        return n
      })
      return
    }
    setBusy(row.id)
    try {
      const updated = await setPercentComplete(row.id, pct)
      setEntries((es) => es.map((e) => (e.id === row.id ? { ...e, ...updated } : e)))
      setDrafts((d) => {
        const n = { ...d }
        delete n[row.id]
        return n
      })
    } catch (err) {
      toast.error(isPeriodClosedError(err) ? 'This month is closed.' : err instanceof Error ? err.message : "Couldn't save.")
    } finally {
      setBusy(null)
    }
  }

  const doClose = async () => {
    if (!period) return
    setBusy('close')
    try {
      await closePeriod(period.id)
      toast.success(`${periodLabel(period.period_end)} closed.`)
      setCloseOpen(false)
      await load(false)
      const res = await getPeriod(period.id)
      if (res) {
        setPeriod(res.period)
        setEntries(res.entries)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close the month.")
    } finally {
      setBusy(null)
    }
  }

  const doReopen = async () => {
    if (!period) return
    setBusy('reopen')
    try {
      await reopenPeriod(period.id)
      toast.success('Month reopened.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reopen.")
    } finally {
      setBusy(null)
    }
  }

  const doPost = async () => {
    if (!period) return
    setBusy('post')
    try {
      const res = await postWipToQbo(period.id)
      toast.success(res.lines === 0 ? 'Nothing to book this month; marked as posted.' : `Posted to QuickBooks with ${res.lines} lines, reversal dated ${formatDateOnly(res.reversal_date)}.`)
      const fresh = await getPeriod(period.id)
      if (fresh) {
        setPeriod(fresh.period)
        setEntries(fresh.entries)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "QuickBooks didn't accept the entry.")
      const fresh = await getPeriod(period.id).catch(() => null)
      if (fresh) setPeriod(fresh.period)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white/20 p-2">
              <CalendarCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Month-end WIP</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Percent complete by work area. Earned against billed, and the entry that squares the books.
              </p>
            </div>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border-0 bg-white/95 px-3 py-2 text-sm font-semibold text-gray-900 outline-none"
            aria-label="Month"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building {periodLabel(periodEnd)} from live data…
        </div>
      ) : period ? (
        <>
          {/* Status + actions */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                closed ? 'bg-slate-100 text-slate-700 ring-slate-200' : 'bg-emerald-100 text-emerald-800 ring-emerald-200'
              }`}
            >
              {closed ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              {periodLabel(period.period_end)} · {closed ? `closed ${formatDateOnly(period.closed_at?.slice(0, 10))}` : 'open'}
            </span>
            {period.qbo_posted_at && (
              <span className="text-xs text-gray-500">
                Posted to QuickBooks {formatDateOnly(period.qbo_posted_at.slice(0, 10))}
                {period.qbo_journal_id ? ` · JE ${period.qbo_journal_id}` : ''}
              </span>
            )}
            {period.qbo_sync_error && (
              <span className="text-xs text-rose-700">QuickBooks: {period.qbo_sync_error}</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!closed && (
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  title="Recompute contract values and billings from live data. Your percents stay."
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              )}
              {!closed ? (
                <button
                  type="button"
                  onClick={() => setCloseOpen(true)}
                  disabled={busy !== null || entries.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  Close month
                </button>
              ) : (
                <>
                  {!period.qbo_journal_id && (
                    <button
                      type="button"
                      onClick={() => void doReopen()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Unlock className="h-4 w-4" />
                      Reopen
                    </button>
                  )}
                  {qbo && !period.qbo_journal_id && (
                    <button
                      type="button"
                      onClick={() => void doPost()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#2CA01C] bg-white px-3.5 py-2 text-sm font-semibold text-[#1f7a13] hover:bg-green-50 disabled:opacity-50"
                    >
                      {busy === 'post' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Post to QuickBooks
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Totals */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Contract" value={formatUSD(totals.contract)} />
            <Stat label="Earned" value={formatUSD(totals.earned)} />
            <Stat label="Billed" value={formatUSD(totals.billed)} />
            <Stat label="Overbilled" value={formatUSD(totals.over)} tone="amber" hint="Billings in excess of earnings (liability)" />
            <Stat label="Underbilled" value={formatUSD(totals.under)} tone="blue" hint="Earnings in excess of billings (asset)" />
          </dl>

          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
              No approved proposals were in play by {formatDateOnly(period.period_end)}. Approve a proposal, or pick a later month.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Work area</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Contract</th>
                    <th className="w-28 px-3 py-2.5 text-right font-semibold">% complete</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Earned</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Over / (under)</th>
                  </tr>
                </thead>
                {byProject.map((g) => {
                  const pc = sumMoney(g.rows.map((r) => r.contract_value))
                  const pe = sumMoney(g.rows.map((r) => r.earned))
                  const pb = sumMoney(g.rows.map((r) => r.billed_to_date))
                  const po = roundMoney(pb - pe)
                  return (
                    <tbody key={g.id} className="border-t border-gray-200">
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                          <Link to={`/app/projects/${g.id}?tab=invoices`} className="hover:underline">
                            {g.name}
                          </Link>
                        </td>
                      </tr>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-800">
                            {r.label}
                            {r.change_order_id ? <span className="ml-2 text-[10px] font-semibold uppercase text-blue-700">CO</span> : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatUSD(r.contract_value)}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={drafts[r.id] ?? String(r.percent_complete)}
                              onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                              onBlur={() => void commitPercent(r)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              }}
                              disabled={closed || busy === r.id}
                              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-gray-50 disabled:text-gray-500"
                              aria-label={`Percent complete, ${r.label}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatUSD(r.earned)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatUSD(r.billed_to_date)}</td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-semibold ${
                              r.over_under > 0 ? 'text-amber-700' : r.over_under < 0 ? 'text-blue-700' : 'text-gray-500'
                            }`}
                          >
                            {r.over_under < 0 ? `(${formatUSD(-r.over_under)})` : formatUSD(r.over_under)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50/70 text-xs font-semibold text-gray-700">
                        <td className="px-4 py-1.5">Project total</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatUSD(pc)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pc > 0 ? `${roundMoney((pe / pc) * 100)}%` : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatUSD(pe)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatUSD(pb)}</td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${po > 0 ? 'text-amber-700' : po < 0 ? 'text-blue-700' : ''}`}>
                          {po < 0 ? `(${formatUSD(-po)})` : formatUSD(po)}
                        </td>
                      </tr>
                    </tbody>
                  )
                })}
              </table>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Earned = contract × percent complete. Billed = invoice lines dated on or before month end. Over means
            billed ahead of the work (a liability on the balance sheet); under means work ahead of the billing (an
            asset). Closing freezes the month; posting books one reversing entry per project in QuickBooks, dated
            month end and reversed the next day.
          </p>
        </>
      ) : null}

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={doClose}
        title={`Close ${periodLabel(periodEnd)}?`}
        description="Percents and amounts freeze as they stand. You can reopen until the entry is posted to QuickBooks."
        confirmLabel="Close month"
      />
    </div>
  )
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'amber' | 'blue'; hint?: string }) {
  const color = tone === 'amber' ? 'text-amber-700' : tone === 'blue' ? 'text-blue-700' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm" title={hint}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  )
}
