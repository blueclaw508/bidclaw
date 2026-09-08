import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileSpreadsheet, Loader2, Plus, Receipt, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewInvoiceModal } from '@/components/invoices/NewInvoiceModal'
import { loadCompanySettings } from '@/lib/companySettings'
import { loadEntitlements, type Entitlements } from '@/lib/entitlements'
import {
  createChangeOrder,
  deleteChangeOrder,
  formatInvoiceNumber,
  INVOICE_GATE_REASON,
  invoiceBalance,
  invoicedChangeOrderIds,
  isInvoiceOverdue,
  listChangeOrders,
  listInvoicesByProject,
  updateChangeOrder,
} from '@/lib/invoices'
import { formatDateOnly, INVOICE_STATUS_CONFIG, OVERDUE_BADGE } from '@/lib/invoiceStatus'
import { formatUSD, sumMoney } from '@/lib/money'
import { listProposalsByProject } from '@/lib/proposals'
import type { ChangeOrder, CompanySettings, Invoice, Project, ProposalListRow } from '@/lib/types'

const UpgradeModal = lazy(() => import('@/components/billing/UpgradeModal'))

const BILLABLE_STATUSES = new Set(['approved', 'in_progress', 'completed'])

/**
 * Invoices tab (roadmap step 2). The list of bills on this project with
 * what is paid and what is owed, the door to a new one, and the change
 * orders that can ride on the next one.
 */
export default function InvoicesTab({ project }: { project: Project }) {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [invoicedCos, setInvoicedCos] = useState<Set<string>>(new Set())
  const [proposals, setProposals] = useState<ProposalListRow[]>([])
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [inv, cos, props, cs, ids] = await Promise.all([
        listInvoicesByProject(project.id),
        listChangeOrders(project.id),
        listProposalsByProject(project.id),
        loadCompanySettings(),
        invoicedChangeOrderIds(project.id),
      ])
      setLoadError(null)
      setInvoices(inv)
      setChangeOrders(cos)
      setProposals(props.filter((p) => BILLABLE_STATUSES.has(p.status)))
      setSettings(cs)
      setInvoicedCos(ids)
      loadEntitlements().then(setEntitlements).catch(() => {})
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Load failed.')
    }
  }, [project.id])

  useEffect(() => {
    // Fetch on mount. Every setState inside load() runs after an await,
    // i.e. in a later task, which is the case the rule exists to allow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const live = useMemo(() => (invoices ?? []).filter((i) => i.status !== 'void'), [invoices])
  const totals = useMemo(
    () => ({
      invoiced: sumMoney(live.map((i) => i.total)),
      paid: sumMoney(live.map((i) => i.amount_paid)),
      outstanding: sumMoney(live.filter((i) => i.status !== 'draft').map((i) => invoiceBalance(i))),
    }),
    [live]
  )
  const billableCos = useMemo(
    () => changeOrders.filter((c) => c.status === 'approved' && !invoicedCos.has(c.id)),
    [changeOrders, invoicedCos]
  )

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <Receipt className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Invoices</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Bills from the proposal's payment schedule, change orders, or a custom amount.
                Each line is allocated to a work area so month-end can read billings by area.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            disabled={!settings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New invoice
          </button>
        </div>
        {invoices && invoices.length > 0 && (
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Stat label="Invoiced" value={formatUSD(totals.invoiced)} />
            <Stat label="Paid" value={formatUSD(totals.paid)} tone="emerald" />
            <Stat label="Outstanding" value={formatUSD(totals.outstanding)} tone={totals.outstanding > 0 ? 'amber' : undefined} />
          </dl>
        )}
      </section>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load invoices: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && invoices === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading invoices…
        </div>
      )}

      {!loadError && invoices && invoices.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">No invoices yet</h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {proposals.length > 0
              ? 'The approved proposal carries a payment schedule. Bill its first milestone with New invoice.'
              : 'Once a proposal is approved, its payment schedule becomes the invoices here. A blank invoice works any time.'}
          </p>
        </div>
      )}

      {!loadError && invoices && invoices.length > 0 && settings && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Invoice</th>
                <th className="px-4 py-2.5 text-left font-semibold">For</th>
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Due</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => {
                const overdue = isInvoiceOverdue(inv)
                const badge = overdue ? OVERDUE_BADGE : INVOICE_STATUS_CONFIG[inv.status]
                return (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/app/projects/${project.id}/invoices/${inv.id}`)}
                    className={`cursor-pointer hover:bg-blue-50/40 ${inv.status === 'void' ? 'text-gray-400' : 'text-gray-800'}`}
                  >
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {formatInvoiceNumber(settings.invoice_prefix, inv.invoice_number)}
                    </td>
                    <td className="px-4 py-3">
                      {inv.milestone_label ?? 'Custom'}
                      {inv.milestone_percent !== null ? (
                        <span className="ml-1 text-xs text-gray-500">· {inv.milestone_percent}%</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateOnly(inv.issue_date)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'font-semibold text-rose-700' : ''}`}>
                      {formatDateOnly(inv.due_date)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatUSD(inv.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {inv.status === 'void' ? '—' : formatUSD(invoiceBalance(inv))}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ChangeOrdersCard
        project={project}
        proposals={proposals}
        changeOrders={changeOrders}
        invoicedIds={invoicedCos}
        onChange={load}
      />

      {settings && (
        <NewInvoiceModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          projectId={project.id}
          proposals={proposals}
          changeOrders={billableCos}
          settings={settings}
          onCreated={(id) => navigate(`/app/projects/${project.id}/invoices/${id}`)}
          onGateError={() => setUpgradeOpen(true)}
        />
      )}

      {upgradeOpen && (
        <Suspense fallback={null}>
          <UpgradeModal
            open={upgradeOpen}
            onClose={() => setUpgradeOpen(false)}
            currentPlan={entitlements?.plan ?? 'free'}
            reason={INVOICE_GATE_REASON}
          />
        </Suspense>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`text-base font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  )
}

/* ============================================================
 * Change orders — numbered, approvable, billed on the next invoice
 * ============================================================ */

function ChangeOrdersCard({
  project,
  proposals,
  changeOrders,
  invoicedIds,
  onChange,
}: {
  project: Project
  proposals: ProposalListRow[]
  changeOrders: ChangeOrder[]
  invoicedIds: Set<string>
  onChange: () => Promise<void> | void
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<ChangeOrder | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(amount)
    if (!title.trim()) return toast.error('Give the change order a title.')
    if (!Number.isFinite(n)) return toast.error('Enter an amount.')
    setBusy('new')
    try {
      await createChangeOrder({
        projectId: project.id,
        proposalId: proposals.length === 1 ? proposals[0].id : null,
        title: title.trim(),
        description: description.trim() || null,
        amount: Math.round(n * 100) / 100,
        status: 'approved',
      })
      setTitle('')
      setAmount('')
      setDescription('')
      setAdding(false)
      await onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add that.")
    } finally {
      setBusy(null)
    }
  }

  const setStatus = async (co: ChangeOrder, status: ChangeOrder['status']) => {
    setBusy(co.id)
    try {
      await updateChangeOrder(co.id, { status })
      await onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update that.")
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    setBusy(toDelete.id)
    try {
      await deleteChangeOrder(toDelete.id)
      setToDelete(null)
      await onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete that.")
    } finally {
      setBusy(null)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">Change orders</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Work added after approval. An approved change order can be included on the next invoice.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" />
            Add change order
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What changed, e.g. Extra drywell at the garage"
            className={inputCls}
            autoFocus
          />
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className={inputCls}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Scope of the change, as the client should read it (optional)"
            className={`${inputCls} sm:col-span-2`}
          />
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={busy === 'new'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {busy === 'new' && <Loader2 className="h-4 w-4 animate-spin" />}
              Save as approved
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {changeOrders.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100">
          {changeOrders.map((co) => {
            const billed = invoicedIds.has(co.id)
            return (
              <li key={co.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="w-8 shrink-0 text-xs font-semibold text-gray-500">#{co.change_number}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{co.title}</p>
                  {co.description ? <p className="truncate text-xs text-gray-500">{co.description}</p> : null}
                </div>
                <span className="tabular-nums font-semibold text-gray-900">{formatUSD(co.amount)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                    co.status === 'approved'
                      ? billed
                        ? 'bg-blue-100 text-blue-800 ring-blue-200'
                        : 'bg-emerald-100 text-emerald-800 ring-emerald-200'
                      : co.status === 'declined'
                        ? 'bg-gray-100 text-gray-500 ring-gray-200'
                        : 'bg-slate-100 text-slate-700 ring-slate-200'
                  }`}
                >
                  {co.status === 'approved' ? (billed ? 'Invoiced' : 'Approved') : co.status === 'declined' ? 'Declined' : 'Draft'}
                </span>
                <div className="flex items-center gap-1">
                  {co.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => void setStatus(co, 'approved')}
                      disabled={busy === co.id}
                      className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50"
                      title="Approve"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  {co.status !== 'declined' && !billed && (
                    <button
                      type="button"
                      onClick={() => void setStatus(co, 'declined')}
                      disabled={busy === co.id}
                      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                      title="Decline"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {!billed && (
                    <button
                      type="button"
                      onClick={() => setToDelete(co)}
                      disabled={busy === co.id}
                      className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Delete change order?"
        description={toDelete ? <>Delete change order #{toDelete.change_number}, "{toDelete.title}"?</> : null}
        confirmLabel="Delete"
        tone="danger"
      />
    </section>
  )
}
