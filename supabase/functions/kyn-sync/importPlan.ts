export interface Rate { name: string; rate: number }
export interface ExistingRate { id: string; name: string; rate_per_hour: number; division_id: string | null }

// KYN's legacy model has no durable crew/equipment IDs. Match only unique,
// exact names. Never repurpose a row by position: kits reference its ID.
export function planRates(incoming: Rate[], existing: ExistingRate[]) {
  const names = new Set<string>()
  const rows = incoming.map(row => {
    if (names.has(row.name)) throw new Error(`Duplicate KYN rate name: ${row.name}. Give each crew or machine a unique name.`)
    names.add(row.name)
    if (!Number.isFinite(row.rate) || row.rate < 0) throw new Error(`Invalid rate for ${row.name}. Correct it in KYN first.`)
    const matches = existing.filter(r => r.name === row.name)
    if (matches.length > 1) throw new Error(`Multiple BidClaw rates named ${row.name}. Resolve duplicate names before importing.`)
    const hit = matches[0]
    // Keep existing user rates, including older imports with no provenance.
    // Incoming rates remain visible for a deliberate manual rate decision.
    return { ...row, action: hit ? 'keep' as const : 'add' as const, currentRate: hit ? Number(hit.rate_per_hour) : null }
  })
  return { incoming: rows, overwrites: 0, appends: rows.filter(r => r.action === 'add').length, untouched: existing.length }
}

export async function previewDigest(value: unknown): Promise<string> {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k,canonical(x)])) : v
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('')
}
