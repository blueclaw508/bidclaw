import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CreditCard,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { RecordPaymentModal } from '@/components/invoices/RecordPaymentModal'
import { supabase } from '@/lib/supabase'
import { loadCompanySettings } from '@/lib/companySettings'
import {
  deleteInvoice,
  deletePayment,
  formatInvoiceNumber,
  getInvoice,
  invoiceBalance,
  isInvoiceOverdue,
  saveInvoiceLines,
  updateInvoice,
} from '@/lib/invoices'
import {
  formatDateOnly,
  INVOICE_STATUS_CONFIG,
  OVERDUE_BADGE,
  PAYMENT_METHOD_LABELS,
} from '@/lib/invoiceStatus'
import { formatUSD, roundMoney, sumMoney } from '@/lib/money'
import { getQboConnection, pushInvoiceToQbo, qboInvoiceUrl, type QboConnection } from '@/lib/qbo'
import type { CompanySettings, InvoiceWithDetails, Project } from '@/lib/types'

interface DraftLine {
  id?: string
  description: string
  quantity: string
  unit_price: string
  proposal_work_area_id: string | null
  change_order_id: string | null
}

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-gray-50 disabled:text-gray-500'

/**
 * One invoice: dates, lines, notes and terms, payments, and the status
 * moves (send, void, delete). Lines and header fields save together on
 * Save; payments and status changes write immediately.
 */
export default function InvoiceEditor() {
  const { projectId, invoiceId } = useParams<{ projectId: string; invoiceId: string }>()
  const navigate = useNavigate()

  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [payOpen, setPayOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // QuickBooks (0045): null until known; the button only shows when connected.
  const [qbo, setQbo] = useState<QboConnection | null>(null)

  const prime = useCallback((inv: InvoiceWithDetails) => {
    setIssueDate(inv.issue_date)
    setDueDate(inv.due_date ?? '')
    setLabel(inv.milestone_label ?? '')
    setNotes(inv.notes ?? '')
    setTerms(inv.terms ?? '')
    setLines(
      inv.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: String(l.quantity),
        unit_price: l.unit_price.toFixed(2),
        proposal_work_area_id: l.proposal_work_area_id,
        change_order_id: l.change_order_id,
      }))
    )
  }, [])

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    try {
      const [inv, cs] = await Promise.all([getInvoice(invoiceId), loadCompanySettings()])
      if (!inv) {
        setNotFound(true)
        return
      }
      setInvoice(inv)
      setSettings(cs)
      prime(inv)
      const { data: proj } = await supabase.from('projects').select('*').eq('id', inv.project_id).maybeSingle()
      setProject((proj as Project) ?? null)
      // Best-effort: a missing connection just hides the button.
      getQboConnection().then(setQbo).catch(() => setQbo(null))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed.')
    } finally {
      setLoading(false)
    }
  }, [invoiceId, prime])

  useEffect(() => {
    void load()
  }, [load])

  const editable = invoice?.status === 'draft' || invoice?.status === 'sent'
  const draftTotal = useMemo(
    () => sumMoney(lines.map((l) => roundMoney((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)))),
    [lines]
  )
  const dirty = useMemo(() => {
    if (!invoice) return false
    if (issueDate !== invoice.issue_date) return true
    if ((dueDate || '') !== (invoice.due_date ?? '')) return true
    if (label !== (invoice.milestone_label ?? '')) return true
    if (notes !== (invoice.notes ?? '')) return true
    if (terms !== (invoice.terms ?? '')) return true
    if (lines.length !== invoice.lines.length) return true
    return lines.some((l, i) => {
      const o = invoice.lines[i]
      return (
        !o ||
        l.id !== o.id ||
        l.description !== o.description ||
        Number(l.quantity) !== o.quantity ||
        Number(l.unit_price) !== o.unit_price
      )
    })
  }, [invoice, issueDate, dueDate, label, notes, terms, lines])

  const save = async () => {
    if (!invoice) return
    if (lines.some((l) => !l.description.trim())) {
      toast.error('Every line needs a description.')
      return
    }
    setSaving(true)
    try {
      await updateInvoice(invoice.id, {
        issue_date: issueDate,
        due_date: dueDate || null,
        milestone_label: label.trim() || null,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
      })
      await saveInvoiceLines(
        invoice.id,
        lines.map((l) => ({
          id: l.id,
          description: l.description.trim(),
          quantity: Number(l.quantity) || 0,
          unit_price: roundMoney(Number(l.unit_price) || 0),
          proposal_work_area_id: l.proposal_work_area_id,
          change_order_id: l.change_order_id,
        }))
      )
      toast.success('Saved.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.")
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (status: 'draft' | 'sent' | 'void') => {
    if (!invoice) return
    setBusy(status)
    try {
      await updateInvoice(invoice.id, { status })
      toast.success(status === 'sent' ? 'Marked as sent.' : status === 'void' ? 'Invoice voided.' : 'Back to draft.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the status.")
    } finally {
      setBusy(null)
      setVoidOpen(false)
    }
  }

  const remove = async () => {
    if (!invoice) return
    setBusy('delete')
    try {
      await deleteInvoice(invoice.id)
      toast.success('Invoice deleted.')
      navigate(`/app/projects/${projectId}?tab=invoices`, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete.")
      setBusy(null)
    }
  }

  const sendToQbo = async () => {
    if (!invoice) return
    setBusy('qbo')
    try {
      const res = await pushInvoiceToQbo(invoice.id)
      toast.success(
        res.payments_pushed > 0
          ? `In QuickBooks, with ${res.payments_pushed} payment${res.payments_pushed === 1 ? '' : 's'}.`
          : 'In QuickBooks.'
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "QuickBooks didn't accept that.")
      await load()
    } finally {
      setBusy(null)
    }
  }

  const removePayment = async (id: string) => {
    setBusy(id)
    try {
      await deletePayment(id)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove that payment.")
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">Loading invoice…</div>
  }
  if (notFound || !invoice || !settings) {
    return (
      <div className="p-8">
        <h2 className="text-lg font-bold text-rose-900">Invoice not found</h2>
        <Link to={`/app/projects/${projectId}?tab=invoices`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
      </div>
    )
  }

  const number = formatInvoiceNumber(settings.invoice_prefix, invoice.invoice_number)
  const overdue = isInvoiceOverdue(invoice)
  const badge = overdue ? OVERDUE_BADGE : INVOICE_STATUS_CONFIG[invoice.status]
  const balance = invoiceBalance(invoice)

  return (
    <div className="space-y-4">
      <Link
        to={`/app/projects/${projectId}?tab=invoices`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {project?.name ?? 'Project'} · Invoices
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{number}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {invoice.milestone_label ?? 'Custom invoice'}
              {invoice.milestone_percent !== null ? ` · ${invoice.milestone_percent}% of contract` : ''}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-right">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total</dt>
              <dd className="text-lg font-bold tabular-nums text-gray-900">{formatUSD(invoice.total)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Paid</dt>
              <dd className="text-lg font-bold tabular-nums text-emerald-700">{formatUSD(invoice.amount_paid)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Balance</dt>
              <dd className={`text-lg font-bold tabular-nums ${balance > 0 && invoice.status !== 'void' ? 'text-amber-700' : 'text-gray-900'}`}>
                {formatUSD(invoice.status === 'void' ? 0 : balance)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          {editable && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {invoice.status === 'draft' && (
            <button
              type="button"
              onClick={() => void setStatus('sent')}
              disabled={busy !== null || dirty || invoice.lines.length === 0}
              title={dirty ? 'Save first' : invoice.lines.length === 0 ? 'Add a line first' : 'Mark this invoice as sent to the client'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-navy bg-white px-3.5 py-2 text-sm font-semibold text-brand-navy hover:bg-blue-50 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Mark as sent
            </button>
          )}
          {invoice.status === 'sent' && invoice.amount_paid === 0 && (
            <button
              type="button"
              onClick={() => void setStatus('draft')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Back to draft
            </button>
          )}
          {(invoice.status === 'sent' || invoice.status === 'paid') && (
            <button
              type="button"
              onClick={() => setPayOpen(true)}
              disabled={busy !== null || (invoice.status === 'paid' && balance <= 0)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              Record payment
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(`/app/projects/${projectId}/invoices/${invoice.id}/print`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Printer className="h-4 w-4" />
            Print / PDF
          </button>
          {qbo && (invoice.status === 'sent' || invoice.status === 'paid') && (
            <button
              type="button"
              onClick={() => void sendToQbo()}
              disabled={busy !== null || dirty}
              title={
                dirty
                  ? 'Save first'
                  : invoice.qbo_invoice_id
                    ? 'Push the latest lines and any new payments to QuickBooks'
                    : `Create this invoice in QuickBooks (${qbo.company_name ?? 'connected company'})`
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2CA01C] bg-white px-3.5 py-2 text-sm font-semibold text-[#1f7a13] hover:bg-green-50 disabled:opacity-50"
            >
              {busy === 'qbo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {invoice.qbo_invoice_id ? 'Update in QuickBooks' : 'Send to QuickBooks'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {invoice.status === 'draft' ? (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : invoice.status !== 'void' ? (
              <button
                type="button"
                onClick={() => setVoidOpen(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                <Ban className="h-4 w-4" />
                Void
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* QuickBooks state (0045) */}
      {(invoice.qbo_invoice_id || invoice.qbo_sync_error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            invoice.qbo_sync_error
              ? 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-green-200 bg-green-50 text-green-900'
          }`}
        >
          {invoice.qbo_sync_error ? (
            <>
              <span className="font-semibold">QuickBooks refused the last push:</span> {invoice.qbo_sync_error}
            </>
          ) : (
            <>
              In QuickBooks
              {invoice.qbo_synced_at ? ` as of ${formatDateOnly(invoice.qbo_synced_at)}` : ''}.{' '}
              {qbo && invoice.qbo_invoice_id ? (
                <a
                  href={qboInvoiceUrl(qbo.environment, invoice.qbo_invoice_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Open in QuickBooks
                </a>
              ) : null}
              {invoice.payments.some((p) => !p.qbo_payment_id) && invoice.status !== 'void'
                ? ' A payment recorded here has not been pushed yet; Update in QuickBooks sends it.'
                : ''}
            </>
          )}
        </div>
      )}

      {/* Dates + label */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Invoice date</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!editable} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={!editable} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Billing for</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!editable} placeholder="Deposit upon acceptance" className={inputCls} />
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Description</th>
                <th className="w-24 px-2 py-2.5 text-right font-semibold">Qty</th>
                <th className="w-32 px-2 py-2.5 text-right font-semibold">Rate</th>
                <th className="w-32 px-4 py-2.5 text-right font-semibold">Amount</th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <tr key={l.id ?? `new-${i}`}>
                  <td className="px-4 py-2">
                    <input
                      value={l.description}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      disabled={!editable}
                      className={inputCls}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.001"
                      value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                      disabled={!editable}
                      className={`${inputCls} text-right`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={l.unit_price}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
                      disabled={!editable}
                      className={`${inputCls} text-right`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                    {formatUSD(roundMoney((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)))}
                  </td>
                  {editable && (
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                    No lines. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                  {dirty ? 'Unsaved total' : 'Total'}
                </td>
                <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-gray-900">
                  {formatUSD(dirty ? draftTotal : invoice.total)}
                </td>
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        {editable && (
          <div className="border-t border-gray-100 p-3">
            <button
              type="button"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { description: '', quantity: '1', unit_price: '0.00', proposal_work_area_id: null, change_order_id: null },
                ])
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900"
            >
              <Plus className="h-4 w-4" />
              Add line
            </button>
          </div>
        )}
      </div>

      {/* Notes + terms */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notes to the client</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} disabled={!editable} className={inputCls} placeholder="Thanks for the work. Anything the client should know about this bill." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Payment terms</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} disabled={!editable} className={inputCls} />
        </div>
      </div>

      {/* Payments */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">Payments</h3>
        {invoice.payments.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            {invoice.status === 'draft' ? 'Mark the invoice as sent, then record payments here.' : 'Nothing received yet.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-28 text-gray-600">{formatDateOnly(p.paid_on)}</span>
                <span className="flex-1 text-gray-800">
                  {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                  {p.reference ? <span className="text-gray-500"> · {p.reference}</span> : null}
                  {p.notes ? <span className="text-gray-500"> · {p.notes}</span> : null}
                </span>
                <span className="tabular-nums font-semibold text-gray-900">{formatUSD(p.amount)}</span>
                {invoice.status !== 'void' && (
                  <button
                    type="button"
                    onClick={() => void removePayment(p.id)}
                    disabled={busy === p.id}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove payment"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoiceId={invoice.id}
        balance={balance}
        onRecorded={() => {
          toast.success('Payment recorded.')
          void load()
        }}
      />

      <ConfirmDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onConfirm={() => setStatus('void')}
        title="Void this invoice?"
        description={
          <>
            {number} stays on the list marked void and keeps its number. Nothing is deleted.
            {invoice.amount_paid > 0 ? ' Payments already recorded stay attached for the record.' : ''}
          </>
        }
        confirmLabel="Void invoice"
        tone="danger"
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete this draft?"
        description={<>Delete {number}? Its number will not be reused.</>}
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
