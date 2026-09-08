import type { InvoiceStatus } from '@/lib/types'

/** Badge styling per invoice status. Overdue is derived and layered on by the caller. */
export const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  sent: { label: 'Sent', className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  paid: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  void: { label: 'Void', className: 'bg-gray-100 text-gray-500 ring-gray-200' },
}

export const OVERDUE_BADGE = { label: 'Overdue', className: 'bg-rose-100 text-rose-800 ring-rose-200' }

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  check: 'Check',
  cash: 'Cash',
  card: 'Card',
  ach: 'ACH / bank transfer',
  other: 'Other',
}

/** YYYY-MM-DD → "Sep 7, 2026". Dates only; no timezone shift. */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Today as YYYY-MM-DD in the browser's local calendar. */
export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}
