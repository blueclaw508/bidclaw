import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { addPayment } from '@/lib/invoices'
import { todayIso } from '@/lib/invoiceStatus'
import { formatUSD } from '@/lib/money'
import type { InvoicePayment, PaymentMethod } from '@/lib/types'

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

export function RecordPaymentModal({
  open,
  onClose,
  invoiceId,
  balance,
  onRecorded,
}: {
  open: boolean
  onClose: () => void
  invoiceId: string
  balance: number
  onRecorded: (p: InvoicePayment) => void
}) {
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('check')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAmount(balance > 0 ? balance.toFixed(2) : '')
    setPaidOn(todayIso())
    setMethod('check')
    setReference('')
    setNotes('')
  }, [open, balance])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter an amount above zero.')
      return
    }
    setSaving(true)
    try {
      const p = await addPayment({
        invoiceId,
        amount: Math.round(n * 100) / 100,
        paidOn,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      })
      onRecorded(p)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record that payment.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title="Record payment" size="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
              required
              autoFocus
            />
            <p className="mt-1 text-[11px] text-gray-500">Balance {formatUSD(balance)}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Date received</label>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="ach">ACH / bank transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Reference <span className="font-normal text-gray-400">(check #, last 4)</span>
            </label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record payment
          </button>
        </div>
      </form>
    </Modal>
  )
}
