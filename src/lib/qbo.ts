import { supabase } from '@/lib/supabase'

/* ============================================================
 * QuickBooks Online (migration 0045) — browser side.
 *
 * Tokens never reach the browser. Everything that touches QuickBooks
 * goes through the qbo-* edge functions as the signed-in contractor.
 * ============================================================ */

export interface QboConnection {
  realm_id: string
  company_name: string | null
  environment: 'sandbox' | 'production'
  connected_at: string
  last_sync_at: string | null
  last_error: string | null
  refresh_token_expires_at: string
}

export interface QboStatus {
  connected: boolean
  company_name?: string | null
  environment?: 'sandbox' | 'production'
  realm_id?: string
  connected_at?: string
  last_sync_at?: string | null
  last_error?: string | null
  items?: Array<{ id: string; name: string }>
  accounts?: Array<{ id: string; name: string; type: string; subtype: string }>
}

export type QboMappingCategory =
  | 'billing'
  | 'labor'
  | 'material'
  | 'equipment'
  | 'disposal'
  | 'design'
  | 'other'
  | 'wip_offset'

export interface QboMapping {
  item_category: QboMappingCategory
  qbo_account_id: string | null
  qbo_account_name: string | null
  qbo_item_id: string | null
  qbo_item_name: string | null
}

export class QboFunctionError extends Error {
  code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.code = code
  }
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let message = 'QuickBooks request failed.'
    let code: string | null = null
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string; code?: string }
        if (payload?.error) message = payload.error
        if (payload?.code) code = payload.code
      } catch {
        /* keep the default */
      }
    }
    throw new QboFunctionError(message, code)
  }
  return data as T
}

/** Cheap: just the connection row, for a badge or a button. */
export async function getQboConnection(): Promise<QboConnection | null> {
  const { data, error } = await supabase.rpc('my_qbo_connection')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as QboConnection[]
  return rows[0] ?? null
}

/** Full status plus the item and account lists the mapping screen needs. */
export async function qboStatus(): Promise<QboStatus> {
  return invoke<QboStatus>('qbo-sync', { action: 'status' })
}

/** Begin the OAuth handshake: the browser leaves for Intuit. */
export async function startQboConnect(returnTo = '/app/settings'): Promise<void> {
  const { url } = await invoke<{ url: string }>('qbo-connect', { return_to: returnTo })
  window.location.assign(url)
}

export async function disconnectQbo(): Promise<void> {
  await invoke<{ ok: true }>('qbo-sync', { action: 'disconnect' })
}

export async function pushInvoiceToQbo(invoiceId: string): Promise<{
  ok: true
  qbo_invoice_id: string
  url: string
  payments_pushed: number
}> {
  return invoke('qbo-sync', { action: 'push_invoice', invoice_id: invoiceId })
}

export function qboInvoiceUrl(environment: string, id: string): string {
  const host = environment === 'production' ? 'https://app.qbo.intuit.com' : 'https://app.sandbox.qbo.intuit.com'
  return `${host}/app/invoice?txnId=${id}`
}

/* ---------- mappings (owner RLS, direct) ---------- */

export async function loadQboMappings(): Promise<Partial<Record<QboMappingCategory, QboMapping>>> {
  const { data, error } = await supabase
    .from('qbo_account_mappings')
    .select('item_category, qbo_account_id, qbo_account_name, qbo_item_id, qbo_item_name')
  if (error) throw new Error(error.message)
  const out: Partial<Record<QboMappingCategory, QboMapping>> = {}
  for (const row of (data ?? []) as QboMapping[]) out[row.item_category] = row
  return out
}

export async function saveQboMapping(
  category: QboMappingCategory,
  patch: Partial<Pick<QboMapping, 'qbo_account_id' | 'qbo_account_name' | 'qbo_item_id' | 'qbo_item_name'>>
): Promise<void> {
  const { data: me } = await supabase.auth.getUser()
  if (!me.user) throw new Error('Not signed in.')
  const { error } = await supabase
    .from('qbo_account_mappings')
    .upsert({ user_id: me.user.id, item_category: category, ...patch }, { onConflict: 'user_id,item_category' })
  if (error) throw new Error(error.message)
}
