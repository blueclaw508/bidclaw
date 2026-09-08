// Shared by qbo-callback and qbo-sync. Supabase deploys one directory per
// function, so this file is COPIED into both; keep the two copies
// identical (diff them in CI if this grows).
//
// Three things live here: token encryption, the Intuit OAuth token
// exchange, and a fetch wrapper that talks to the QuickBooks API with a
// fresh access token, refreshing and re-encrypting when it has to.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>

export const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const OAUTH_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
export const MINOR_VERSION = 73

export function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export function environment(): 'sandbox' | 'production' {
  return Deno.env.get('QBO_ENVIRONMENT') === 'production' ? 'production' : 'sandbox'
}

export function apiBase(envName: string, realmId: string): string {
  const host =
    envName === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com'
  return `${host}/v3/company/${realmId}`
}

/** The QuickBooks web app URL for a transaction, so the UI can link out. */
export function qboAppUrl(envName: string, kind: 'invoice' | 'payment' | 'customer', id: string): string {
  const host = envName === 'production' ? 'https://app.qbo.intuit.com' : 'https://app.sandbox.qbo.intuit.com'
  if (kind === 'customer') return `${host}/app/customerdetail?nameId=${id}`
  if (kind === 'payment') return `${host}/app/recvpayment?txnId=${id}`
  return `${host}/app/invoice?txnId=${id}`
}

// ── Encryption ────────────────────────────────────────────────────────
// AES-256-GCM with a random 12-byte IV, key from QBO_TOKEN_KEY (64 hex
// chars). Ciphertext is base64(iv || ct). The key never touches the DB.

async function key(): Promise<CryptoKey> {
  const hex = env('QBO_TOKEN_KEY')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('QBO_TOKEN_KEY must be 64 hex characters')
  const raw = new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  return new Uint8Array(atob(s).split('').map((c) => c.charCodeAt(0)))
}

export async function encrypt(plain: string): Promise<string> {
  const k = await key()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain))
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64(out)
}

export async function decrypt(enc: string): Promise<string> {
  const k = await key()
  const all = unb64(enc)
  const iv = all.slice(0, 12)
  const ct = all.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct)
  return new TextDecoder().decode(plain)
}

// ── OAuth ─────────────────────────────────────────────────────────────

export interface TokenSet {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

function basicAuth(): string {
  return 'Basic ' + btoa(`${env('QBO_CLIENT_ID')}:${env('QBO_CLIENT_SECRET')}`)
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  })
  if (!res.ok) throw new Error(`Intuit token exchange failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenSet
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) throw new Error(`Intuit token refresh failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenSet
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: refreshToken }),
  }).catch(() => undefined)
}

/** Write a token set onto the connection row, encrypted. */
export async function storeTokens(
  service: SupabaseClient,
  userId: string,
  realmId: string,
  tokens: TokenSet,
  extra: Row = {}
): Promise<void> {
  const now = Date.now()
  const row: Row = {
    user_id: userId,
    realm_id: realmId,
    environment: environment(),
    access_token_enc: await encrypt(tokens.access_token),
    access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token_enc: await encrypt(tokens.refresh_token),
    refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    ...extra,
  }
  const { error } = await service.from('qbo_connections').upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Could not store QuickBooks tokens: ${error.message}`)
}

// ── Authenticated API access ─────────────────────────────────────────

export interface Connection {
  user_id: string
  realm_id: string
  environment: string
  company_name: string | null
  accessToken: string
}

/**
 * Load the contractor's connection with a usable access token, refreshing
 * (and re-storing) when the current one is within five minutes of expiry.
 * Throws with a plain sentence when there is no connection or the refresh
 * token itself has lapsed — the UI shows that sentence.
 */
export async function loadConnection(service: SupabaseClient, userId: string): Promise<Connection> {
  const { data, error } = await service.from('qbo_connections').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('QuickBooks is not connected.')
  const row = data as Row
  if (new Date(row.refresh_token_expires_at).getTime() < Date.now()) {
    throw new Error('The QuickBooks connection has expired. Connect it again in Settings.')
  }
  let accessToken = await decrypt(row.access_token_enc)
  if (new Date(row.access_token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const fresh = await refreshTokens(await decrypt(row.refresh_token_enc))
    await storeTokens(service, userId, row.realm_id, fresh, { company_name: row.company_name })
    accessToken = fresh.access_token
  }
  return {
    user_id: userId,
    realm_id: row.realm_id,
    environment: row.environment,
    company_name: row.company_name ?? null,
    accessToken,
  }
}

export class QboError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** One call to the QuickBooks API. Path is relative to the company root. */
export async function qbo<T = Row>(
  conn: Connection,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(apiBase(conn.environment, conn.realm_id) + path)
  url.searchParams.set('minorversion', String(MINOR_VERSION))
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) {
    const fault = (parsed as Row)?.Fault?.Error?.[0]
    const msg = fault ? `${fault.Message}${fault.Detail ? ` — ${fault.Detail}` : ''}` : `QuickBooks returned ${res.status}`
    throw new QboError(res.status, msg, parsed)
  }
  return parsed as T
}

/** QuickBooks' query language wants single quotes doubled. */
export function q(s: string): string {
  return s.replace(/'/g, "''")
}

export async function log(
  service: SupabaseClient,
  userId: string,
  entry: { kind: string; entity_id?: string | null; qbo_id?: string | null; status: 'ok' | 'error'; message?: string | null }
) {
  await service
    .from('qbo_sync_log')
    .insert({ user_id: userId, ...entry })
    .then(({ error }) => {
      if (error) console.warn('qbo log failed:', error.message)
    })
}
