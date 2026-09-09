import { useState } from 'react'
import { supplierQuoteStatus } from '../../supabase/functions/_shared/supplierQuote.ts'
import type { CatalogItem } from '@/lib/types'
import { formatUSD } from '@/lib/money'

export function SupplierQuoteEditor({ item, onSave }: { item: CatalogItem; onSave: (changes: Partial<CatalogItem>) => Promise<boolean> }) {
  const q = item.supplier_quote
  const [supplier, setSupplier] = useState(q?.supplier ?? '')
  const [reference, setReference] = useState(q?.reference ?? '')
  const [quoted, setQuoted] = useState(q?.quoted_on ?? '')
  const [expiry, setExpiry] = useState(q?.expires_on ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = supplierQuoteStatus(q, Number(item.unit_cost), item.unit)
  const today = new Date().toISOString().slice(0,10)
  const valid = supplier.trim() && reference.trim() && quoted && quoted <= today && (!expiry || expiry >= quoted) && confirmed && Number(item.unit_cost) > 0
  const input = 'mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-base'
  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      if (await onSave({ supplier_quote: { supplier:supplier.trim(), reference:reference.trim(), quoted_on:quoted, expires_on:expiry || null, unit_cost:Number(item.unit_cost), unit:item.unit } })) setConfirmed(false)
    } finally { setBusy(false) }
  }
  return <section className="rounded-lg border border-blue-200 bg-white p-4">
    <h3 className="font-semibold">Supplier quote</h3>
    <p className={`mt-1 text-sm ${status.review ? 'text-amber-800' : 'text-gray-600'}`}>{status.label}</p>
    <p className="mt-2 text-sm">Record the quote supporting {formatUSD(Number(item.unit_cost))}/{item.unit}. Save cost or item changes above first; they clear this confirmation. Existing estimates and proposals keep their saved prices.</p>
    <fieldset disabled={busy} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label>Supplier<input maxLength={200} value={supplier} onChange={e => {setSupplier(e.target.value);setConfirmed(false)}} className={input}/></label>
      <label>Quote reference or document link<input maxLength={1000} value={reference} onChange={e => {setReference(e.target.value);setConfirmed(false)}} className={input} placeholder="Quote number, email reference, or link"/></label>
      <label>Quote date<input type="date" max={today} value={quoted} onChange={e => {setQuoted(e.target.value);setConfirmed(false)}} className={input}/></label>
      <label>Valid through (optional)<input type="date" min={quoted} value={expiry} onChange={e => {setExpiry(e.target.value);setConfirmed(false)}} className={input}/></label>
    </fieldset>
    <label className="mt-3 flex items-start gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/><span>I checked this quote and confirm the catalog price and unit, including the intended delivery and tax basis.</span></label>
    <button type="button" disabled={!valid || busy} onClick={() => void save()} className="mt-3 rounded bg-brand-navy px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save quote confirmation'}</button>
  </section>
}
