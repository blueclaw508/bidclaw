export interface SupplierQuote {
  supplier: string
  reference: string
  quoted_on: string
  expires_on: string | null
  unit_cost: number
  unit: string
  confirmed_at?: string
}

function normalizedUnit(value: string) {
  const unit = value.trim().toLowerCase().replace(/\s+/g, ' ')
  const aliases: Record<string,string> = { 'sq ft':'sf', sqft:'sf', each:'ea', hour:'hr', hours:'hr', hrs:'hr', 'linear feet':'lf', 'cubic yard':'cy', 'cubic yards':'cy' }
  return aliases[unit] ?? unit
}

export function supplierQuoteStatus(value: unknown, cost: number, unit: string, today = new Date().toISOString().slice(0, 10)) {
  const q = value as SupplierQuote | null
  if (!q || typeof q !== 'object') return { review: false, label: 'Catalog price; no supplier quote recorded.' }
  const date = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
  if (typeof q.supplier !== 'string' || !q.supplier.trim() || typeof q.reference !== 'string' || !q.reference.trim() || !date(q.quoted_on) || q.quoted_on > today
    || Number(q.unit_cost) !== cost || typeof q.unit !== 'string' || normalizedUnit(q.unit) !== normalizedUnit(unit) || !q.confirmed_at
    || (q.expires_on !== null && (!date(q.expires_on) || q.expires_on < q.quoted_on))) {
    return { review: true, label: 'Supplier quote does not match this price/unit or is incomplete. Confirm the price again.' }
  }
  const expired = q.expires_on !== null && q.expires_on < today
  return {
    review: expired || !q.expires_on,
    label: `${expired ? 'Expired supplier quote' : 'Contractor-confirmed supplier quote'}: ${q.supplier}; ${q.reference}; quoted ${q.quoted_on}; ${q.expires_on ? `valid through ${q.expires_on}` : 'expiry not supplied — reconfirm before use'}.`,
  }
}

/** Evidence comes from a unique catalog match, never from a model's claim of verification. */
export function catalogPriceEvidence(catalog: readonly Record<string, unknown>[], name: string, cost: number, unit: string) {
  const matches = catalog.filter(item => String(item.name).trim().toLowerCase() === name.trim().toLowerCase())
  if (matches.length !== 1) return { review:false, label:'Price source not uniquely matched to a catalog item. Confirm against your own numbers.' }
  const item = matches[0]
  if (item.supplier_quote) return supplierQuoteStatus(item.supplier_quote, cost, unit)
  return { review:false, label: Number(item.unit_cost) === cost && normalizedUnit(String(item.unit)) === normalizedUnit(unit)
    ? 'Catalog price; no supplier quote recorded.' : 'Price differs from the catalog or uses another unit. Confirm against your own numbers.' }
}
