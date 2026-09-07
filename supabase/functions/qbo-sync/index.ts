// qbo-sync — everything the signed-in contractor does with their
// QuickBooks company after connecting.
//
//   status          connection + the lists the mapping screen needs
//   disconnect      revoke the token, forget the connection
//   push_invoice    customer → invoice → payments, create or update
//
// verify_jwt ON. Every action resolves the caller from the JWT and works
// only on that account's rows; the QuickBooks tokens never leave here.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  decrypt,
  loadConnection,
  log,
  q,
  qbo,
  qboAppUrl,
  QboError,
  revokeToken,
  type Connection,
  type Row,
} from './qbo_shared.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Not signed in.' }, 401)

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let body: Row
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'status':
        return json(await status(service, user.id))
      case 'disconnect':
        return json(await disconnect(service, user.id))
      case 'push_invoice':
        return json(await pushInvoice(service, user.id, String(body.invoice_id ?? '')))
      case 'post_wip':
        return json(await postWip(service, user.id, String(body.period_id ?? '')))
      case 'pull_costs':
        return json(await pullCosts(service, user.id, String(body.from ?? ''), String(body.to ?? '')))
      default:
        return json({ error: 'Unknown action.' }, 400)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const statusCode = err instanceof QboError ? 502 : msg.includes('not connected') || msg.includes('expired') ? 409 : 500
    console.error(`qbo-sync ${action}:`, msg)
    return json({ error: msg }, statusCode)
  }
})

// ── status ────────────────────────────────────────────────────────────

async function status(service: SupabaseClient, userId: string) {
  const { data: row } = await service.from('qbo_connections').select('*').eq('user_id', userId).maybeSingle()
  if (!row) return { connected: false }
  const conn = await loadConnection(service, userId)
  // Service items for the billing line; income + balance-sheet accounts
  // for the category and WIP mappings.
  const [items, accounts] = await Promise.all([
    qbo<Row>(conn, '/query', { query: { query: "select Id, Name, Type, Active from Item where Type = 'Service' and Active = true maxresults 500" } }),
    qbo<Row>(conn, '/query', {
      query: {
        query:
          "select Id, Name, AccountType, AccountSubType, Active from Account where Active = true and AccountType in ('Income', 'Other Current Liability', 'Other Current Asset', 'Cost of Goods Sold', 'Expense') maxresults 1000",
      },
    }),
  ])
  return {
    connected: true,
    company_name: (row as Row).company_name,
    environment: (row as Row).environment,
    realm_id: (row as Row).realm_id,
    connected_at: (row as Row).connected_at,
    last_sync_at: (row as Row).last_sync_at,
    last_error: (row as Row).last_error,
    items: (items?.QueryResponse?.Item ?? []).map((i: Row) => ({ id: i.Id, name: i.Name })),
    accounts: (accounts?.QueryResponse?.Account ?? []).map((a: Row) => ({
      id: a.Id,
      name: a.Name,
      type: a.AccountType,
      subtype: a.AccountSubType,
    })),
  }
}

// ── disconnect ────────────────────────────────────────────────────────

async function disconnect(service: SupabaseClient, userId: string) {
  const { data: row } = await service.from('qbo_connections').select('refresh_token_enc').eq('user_id', userId).maybeSingle()
  if (row) {
    try {
      await revokeToken(await decrypt((row as Row).refresh_token_enc))
    } catch {
      /* revoke is courtesy; deleting the row is the disconnect */
    }
    await service.from('qbo_connections').delete().eq('user_id', userId)
  }
  await log(service, userId, { kind: 'disconnect', status: 'ok' })
  return { ok: true }
}

// ── push_invoice ──────────────────────────────────────────────────────

async function pushInvoice(service: SupabaseClient, userId: string, invoiceId: string) {
  if (!invoiceId) throw new Error('Which invoice?')
  const { data: inv, error } = await service
    .from('invoices')
    .select('*, invoice_lines ( * ), invoice_payments ( * ), project:projects ( id, name, customer_id, customer:customers ( * ) )')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!inv) throw new Error('Invoice not found.')
  const invoice = inv as Row
  if (invoice.status === 'draft') throw new Error('Mark the invoice as sent before sending it to QuickBooks.')
  if (invoice.status === 'void') throw new Error('A voided invoice is not sent to QuickBooks. Void it there by hand if it was already pushed.')

  const conn = await loadConnection(service, userId)
  const { data: settings } = await service.from('company_settings').select('invoice_prefix').eq('user_id', userId).maybeSingle()
  const docNumber = `${(settings as Row | null)?.invoice_prefix ?? 'INV-'}${String(invoice.invoice_number).padStart(4, '0')}`

  // The billing item this company maps its lines to.
  const { data: mapping } = await service
    .from('qbo_account_mappings')
    .select('qbo_item_id, qbo_item_name')
    .eq('user_id', userId)
    .eq('item_category', 'billing')
    .maybeSingle()
  const itemId = (mapping as Row | null)?.qbo_item_id
  if (!itemId) {
    throw new Error('Pick the QuickBooks item that invoice lines post to, under Settings → QuickBooks, then try again.')
  }

  try {
    // 1. Customer
    const customer = invoice.project?.customer as Row | null
    if (!customer) throw new Error('This project has no customer. Set one on the Details tab first.')
    const customerId = await ensureCustomer(service, userId, conn, customer)

    // 2. Invoice — create, or sparse-update when we already pushed it.
    const lines = ((invoice.invoice_lines ?? []) as Row[])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: Number(l.amount),
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: String(itemId) },
          Qty: Number(l.quantity),
          UnitPrice: Number(l.unit_price),
        },
      }))
    const payload: Row = {
      CustomerRef: { value: customerId },
      TxnDate: invoice.issue_date,
      DueDate: invoice.due_date ?? undefined,
      DocNumber: docNumber,
      PrivateNote: `BidClaw invoice ${docNumber}${invoice.milestone_label ? ` · ${invoice.milestone_label}` : ''}`,
      CustomerMemo: invoice.notes ? { value: String(invoice.notes).slice(0, 1000) } : undefined,
      Line: lines,
    }

    let qboInvoice: Row
    if (invoice.qbo_invoice_id) {
      const current = await qbo<Row>(conn, `/invoice/${invoice.qbo_invoice_id}`)
      const existing = current.Invoice as Row
      qboInvoice = (
        await qbo<Row>(conn, '/invoice', {
          method: 'POST',
          body: { ...payload, Id: existing.Id, SyncToken: existing.SyncToken, sparse: false },
        })
      ).Invoice
    } else {
      qboInvoice = (await qbo<Row>(conn, '/invoice', { method: 'POST', body: payload })).Invoice
    }
    await service
      .from('invoices')
      .update({ qbo_invoice_id: String(qboInvoice.Id), qbo_synced_at: new Date().toISOString(), qbo_sync_error: null })
      .eq('id', invoiceId)
    await log(service, userId, { kind: 'invoice', entity_id: invoiceId, qbo_id: String(qboInvoice.Id), status: 'ok' })

    // 3. Payments not yet in QuickBooks.
    let pushedPayments = 0
    for (const p of (invoice.invoice_payments ?? []) as Row[]) {
      if (p.qbo_payment_id) continue
      const res = await qbo<Row>(conn, '/payment', {
        method: 'POST',
        body: {
          CustomerRef: { value: customerId },
          TotalAmt: Number(p.amount),
          TxnDate: p.paid_on,
          PrivateNote: [`BidClaw payment on ${docNumber}`, p.method, p.reference].filter(Boolean).join(' · '),
          Line: [{ Amount: Number(p.amount), LinkedTxn: [{ TxnId: String(qboInvoice.Id), TxnType: 'Invoice' }] }],
        },
      })
      const qboPayment = res.Payment as Row
      await service.from('invoice_payments').update({ qbo_payment_id: String(qboPayment.Id) }).eq('id', p.id)
      await log(service, userId, { kind: 'payment', entity_id: p.id, qbo_id: String(qboPayment.Id), status: 'ok' })
      pushedPayments++
    }

    await service.from('qbo_connections').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('user_id', userId)
    return {
      ok: true,
      qbo_invoice_id: String(qboInvoice.Id),
      url: qboAppUrl(conn.environment, 'invoice', String(qboInvoice.Id)),
      payments_pushed: pushedPayments,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await service.from('invoices').update({ qbo_sync_error: msg }).eq('id', invoiceId)
    await service.from('qbo_connections').update({ last_error: msg }).eq('user_id', userId)
    await log(service, userId, { kind: 'invoice', entity_id: invoiceId, status: 'error', message: msg })
    throw err
  }
}

// ── pull_costs ────────────────────────────────────────────────────────
// Expense lines coded to a customer or job in QuickBooks, landed on the
// BidClaw project. Purchase (cash, check, card), Bill, and JournalEntry
// debit lines on expense or cost-of-goods accounts. Idempotent by
// transaction and line id; a hand assignment or category on a row is
// kept across pulls; a line deleted over there disappears here on the
// next pull of its range.

const COST_ACCOUNT_TYPES = new Set(['Expense', 'Cost of Goods Sold', 'Other Expense'])

function guessCategory(accountName: string, itemName: string | null): string {
  const s = `${accountName} ${itemName ?? ''}`.toLowerCase()
  if (/labor|labour|payroll|wage|salar|crew|foreman|overtime/.test(s)) return 'labor'
  if (/subcontract|sub-contract|\bsubs?\b|contractor|electric|plumb|irrigat/.test(s)) return 'subcontractor'
  if (/equipment|rental|fuel|diesel|gas\b|machine|excavator|truck/.test(s)) return 'equipment'
  if (/material|supplies|stone|masonry|nursery|plant|lumber|concrete|gravel|loam|mulch|pipe|hardware|aggregate/.test(s)) return 'material'
  return 'other'
}

async function qboQueryAll(conn: Connection, entity: string, where: string): Promise<Row[]> {
  const out: Row[] = []
  let start = 1
  const page = 1000
  for (;;) {
    const res = await qbo<Row>(conn, '/query', {
      query: { query: `select * from ${entity} ${where} startposition ${start} maxresults ${page}` },
    })
    const rows: Row[] = res?.QueryResponse?.[entity] ?? []
    out.push(...rows)
    if (rows.length < page) break
    start += page
  }
  return out
}

async function pullCosts(service: SupabaseClient, userId: string, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('Give a date range, oldest first.')
  }
  const conn = await loadConnection(service, userId)

  // Who is who on our side.
  const [{ data: custs }, { data: projects }, { data: maps }] = await Promise.all([
    service.from('customers').select('id, name, qbo_customer_id').eq('user_id', userId),
    service.from('projects').select('id, name, customer_id, status').eq('user_id', userId),
    service.from('qbo_account_mappings').select('item_category, qbo_account_id').eq('user_id', userId),
  ])
  const custByQbo = new Map<string, Row>()
  for (const c of (custs ?? []) as Row[]) if (c.qbo_customer_id) custByQbo.set(String(c.qbo_customer_id), c)
  const projectsByCustomer = new Map<string, Row[]>()
  for (const p of (projects ?? []) as Row[]) {
    if (!p.customer_id || p.status === 'archived') continue
    const list = projectsByCustomer.get(p.customer_id) ?? []
    list.push(p)
    projectsByCustomer.set(p.customer_id, list)
  }
  const mappedCategory = new Map<string, string>()
  const mapCat: Record<string, string> = { labor: 'labor', material: 'material', equipment: 'equipment', disposal: 'other', design: 'subcontractor', other: 'other' }
  for (const m of (maps ?? []) as Row[]) if (m.qbo_account_id && mapCat[m.item_category]) mappedCategory.set(String(m.qbo_account_id), mapCat[m.item_category])

  // Who is who on their side.
  const [qboCustomers, qboAccounts] = await Promise.all([
    qboQueryAll(conn, 'Customer', ''),
    qboQueryAll(conn, 'Account', ''),
  ])
  const qboCust = new Map<string, Row>()
  for (const c of qboCustomers) qboCust.set(String(c.Id), c)
  const acctType = new Map<string, { name: string; type: string }>()
  for (const a of qboAccounts) acctType.set(String(a.Id), { name: String(a.Name ?? ''), type: String(a.AccountType ?? '') })

  // Which project does a CustomerRef land on?
  const resolveProject = (refId: string): { customer_id: string | null; project_id: string | null } => {
    const qc = qboCust.get(refId)
    const parentId = qc?.ParentRef?.value ? String(qc.ParentRef.value) : null
    const ours = custByQbo.get(refId) ?? (parentId ? custByQbo.get(parentId) : undefined)
    if (!ours) return { customer_id: null, project_id: null }
    const candidates = projectsByCustomer.get(ours.id) ?? []
    if (qc && parentId) {
      const name = String(qc.DisplayName ?? '').trim().toLowerCase()
      const hit = candidates.find((p) => String(p.name).trim().toLowerCase() === name)
      if (hit) return { customer_id: ours.id, project_id: hit.id }
    }
    if (candidates.length === 1) return { customer_id: ours.id, project_id: candidates[0].id }
    return { customer_id: ours.id, project_id: null }
  }

  const where = `where TxnDate >= '${from}' and TxnDate <= '${to}'`
  const [purchases, bills, journals] = await Promise.all([
    qboQueryAll(conn, 'Purchase', where),
    qboQueryAll(conn, 'Bill', where),
    qboQueryAll(conn, 'JournalEntry', where),
  ])

  type CostRow = Row
  const rows: CostRow[] = []
  const push = (
    txnType: string,
    txn: Row,
    line: Row,
    customerRef: string | undefined,
    accountId: string | null,
    accountNameFallback: string | null,
    itemName: string | null,
    vendor: string | null,
    amount: number
  ) => {
    if (!customerRef || !Number.isFinite(amount) || amount === 0) return
    const acct = accountId ? acctType.get(accountId) : undefined
    if (acct && !COST_ACCOUNT_TYPES.has(acct.type)) return
    const accountName = acct?.name ?? accountNameFallback ?? ''
    const landing = resolveProject(customerRef)
    rows.push({
      user_id: userId,
      project_id: landing.project_id,
      customer_id: landing.customer_id,
      qbo_txn_type: txnType,
      qbo_txn_id: String(txn.Id),
      qbo_line_id: String(line.Id ?? line.LineNum ?? '0'),
      qbo_customer_ref: customerRef,
      txn_date: String(txn.TxnDate),
      vendor_name: vendor,
      account_id: accountId,
      account_name: accountName || null,
      category: (accountId && mappedCategory.get(accountId)) || guessCategory(accountName, itemName),
      description: line.Description ?? txn.PrivateNote ?? null,
      amount: Math.round(amount * 100) / 100,
      pulled_at: new Date().toISOString(),
    })
  }

  for (const t of purchases) {
    const vendor = t.EntityRef?.name ?? null
    for (const l of (t.Line ?? []) as Row[]) {
      const d = l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail
      if (!d) continue
      push('Purchase', t, l, d.CustomerRef?.value, d.AccountRef?.value ? String(d.AccountRef.value) : null, d.AccountRef?.name ?? null, d.ItemRef?.name ?? null, vendor, Number(l.Amount))
    }
  }
  for (const t of bills) {
    const vendor = t.VendorRef?.name ?? null
    for (const l of (t.Line ?? []) as Row[]) {
      const d = l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail
      if (!d) continue
      push('Bill', t, l, d.CustomerRef?.value, d.AccountRef?.value ? String(d.AccountRef.value) : null, d.AccountRef?.name ?? null, d.ItemRef?.name ?? null, vendor, Number(l.Amount))
    }
  }
  for (const t of journals) {
    for (const l of (t.Line ?? []) as Row[]) {
      const d = l.JournalEntryLineDetail
      if (!d || d.PostingType !== 'Debit') continue
      if (d.Entity?.Type !== 'Customer') continue
      push('JournalEntry', t, l, d.Entity?.EntityRef?.value, d.AccountRef?.value ? String(d.AccountRef.value) : null, d.AccountRef?.name ?? null, null, d.Entity?.EntityRef?.name ?? 'Journal entry', Number(l.Amount))
    }
  }

  // Keep what a person pinned.
  const { data: existing } = await service
    .from('job_costs')
    .select('qbo_txn_type, qbo_txn_id, qbo_line_id, project_id, project_pinned, category, category_pinned')
    .eq('user_id', userId)
    .gte('txn_date', from)
    .lte('txn_date', to)
  const pinned = new Map<string, Row>()
  for (const e of (existing ?? []) as Row[]) pinned.set(`${e.qbo_txn_type}:${e.qbo_txn_id}:${e.qbo_line_id}`, e)
  for (const r of rows) {
    const e = pinned.get(`${r.qbo_txn_type}:${r.qbo_txn_id}:${r.qbo_line_id}`)
    if (!e) continue
    if (e.project_pinned) {
      r.project_id = e.project_id
      r.project_pinned = true
    }
    if (e.category_pinned) {
      r.category = e.category
      r.category_pinned = true
    }
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await service
        .from('job_costs')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,qbo_txn_type,qbo_txn_id,qbo_line_id' })
      if (error) throw new Error(`Could not store costs: ${error.message}`)
    }
  }
  // Lines gone from QuickBooks are gone here too — but only inside the
  // range we just read completely.
  const seen = new Set(rows.map((r) => `${r.qbo_txn_type}:${r.qbo_txn_id}:${r.qbo_line_id}`))
  const stale = ((existing ?? []) as Row[]).filter((e) => !seen.has(`${e.qbo_txn_type}:${e.qbo_txn_id}:${e.qbo_line_id}`))
  for (const e of stale) {
    await service
      .from('job_costs')
      .delete()
      .eq('user_id', userId)
      .eq('qbo_txn_type', e.qbo_txn_type)
      .eq('qbo_txn_id', e.qbo_txn_id)
      .eq('qbo_line_id', e.qbo_line_id)
  }

  await service
    .from('qbo_connections')
    .update({ costs_pulled_from: from, costs_pulled_to: to, costs_pulled_at: new Date().toISOString(), last_sync_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId)
  const assigned = rows.filter((r) => r.project_id).length
  await log(service, userId, { kind: 'journal', status: 'ok', message: `pulled ${rows.length} cost lines ${from}..${to}, ${assigned} assigned` })
  return { ok: true, lines: rows.length, assigned, unassigned: rows.length - assigned, removed: stale.length, from, to }
}

// ── post_wip ──────────────────────────────────────────────────────────
// One journal entry per closed month, one pair of lines per project:
//   overbilled  (billed > earned): Dr Revenue        / Cr WIP liability
//   underbilled (earned > billed): Dr WIP asset      / Cr Revenue
// dated month end, plus the mirror image dated the next day so the month
// after starts from the books as invoiced. Lines carry the customer as
// Entity when QuickBooks knows them, so job reports still tie out.

async function postWip(service: SupabaseClient, userId: string, periodId: string) {
  if (!periodId) throw new Error('Which month?')
  const { data: period, error } = await service
    .from('wip_periods')
    .select('*')
    .eq('id', periodId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!period) throw new Error('Month not found.')
  const p = period as Row
  if (p.status !== 'closed') throw new Error('Close the month first, then post it.')
  if (p.qbo_journal_id) throw new Error('This month is already in QuickBooks. Void the entry there to post it again.')

  const { data: maps } = await service
    .from('qbo_account_mappings')
    .select('item_category, qbo_account_id, qbo_account_name')
    .eq('user_id', userId)
    .in('item_category', ['revenue', 'wip_asset', 'wip_liability'])
  const acct: Record<string, string> = {}
  for (const m of (maps ?? []) as Row[]) if (m.qbo_account_id) acct[m.item_category] = String(m.qbo_account_id)
  const missing = ['revenue', 'wip_asset', 'wip_liability'].filter((k) => !acct[k])
  if (missing.length > 0) {
    throw new Error('Map the WIP accounts under Settings → QuickBooks first: revenue, WIP asset, WIP liability.')
  }

  const { data: entries } = await service
    .from('wip_entries')
    .select('project_id, over_under, project:projects ( name, customer:customers ( id, name, qbo_customer_id ) )')
    .eq('period_id', periodId)
  const byProject = new Map<string, { name: string; customer: Row | null; net: number }>()
  for (const e of (entries ?? []) as Row[]) {
    const g = byProject.get(e.project_id) ?? { name: e.project?.name ?? 'Project', customer: e.project?.customer ?? null, net: 0 }
    g.net = Math.round((g.net + Number(e.over_under)) * 100) / 100
    byProject.set(e.project_id, g)
  }

  const conn = await loadConnection(service, userId)
  const periodEnd: string = p.period_end
  const [y, m, d] = periodEnd.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const reversalDate = next.toISOString().slice(0, 10)
  const tag = periodEnd.slice(0, 7).replace('-', '')

  type Line = { Description: string; Amount: number; DetailType: 'JournalEntryLineDetail'; JournalEntryLineDetail: Row }
  const mk = (desc: string, amount: number, posting: 'Debit' | 'Credit', account: string, customerId: string | null): Line => ({
    Description: desc,
    Amount: amount,
    DetailType: 'JournalEntryLineDetail',
    JournalEntryLineDetail: {
      PostingType: posting,
      AccountRef: { value: account },
      ...(customerId ? { Entity: { Type: 'Customer', EntityRef: { value: customerId } } } : {}),
    },
  })

  const lines: Line[] = []
  for (const [, g] of byProject) {
    if (g.net === 0) continue
    const amt = Math.abs(g.net)
    const cust = g.customer?.qbo_customer_id ? String(g.customer.qbo_customer_id) : null
    const desc = `${g.name} — WIP ${periodEnd}`
    if (g.net > 0) {
      lines.push(mk(desc, amt, 'Debit', acct.revenue, cust), mk(desc, amt, 'Credit', acct.wip_liability, cust))
    } else {
      lines.push(mk(desc, amt, 'Debit', acct.wip_asset, cust), mk(desc, amt, 'Credit', acct.revenue, cust))
    }
  }

  try {
    if (lines.length === 0) {
      await service.from('wip_periods').update({ qbo_posted_at: new Date().toISOString(), qbo_sync_error: null }).eq('id', periodId)
      await log(service, userId, { kind: 'journal', entity_id: periodId, status: 'ok', message: 'nothing to book' })
      return { ok: true, journal_id: null, reversal_id: null, lines: 0, reversal_date: reversalDate }
    }

    const post = async (txnDate: string, docNumber: string, ls: Line[], note: string) => {
      const body = { TxnDate: txnDate, DocNumber: docNumber, PrivateNote: note, Line: ls }
      try {
        return (await qbo<Row>(conn, '/journalentry', { method: 'POST', body })).JournalEntry as Row
      } catch (err) {
        // Some companies refuse a customer on a non-A/R line; the entry
        // still balances without it.
        if (err instanceof QboError && /entity/i.test(err.message)) {
          const stripped = ls.map((l) => ({ ...l, JournalEntryLineDetail: { PostingType: l.JournalEntryLineDetail.PostingType, AccountRef: l.JournalEntryLineDetail.AccountRef } }))
          return (await qbo<Row>(conn, '/journalentry', { method: 'POST', body: { ...body, Line: stripped } })).JournalEntry as Row
        }
        throw err
      }
    }

    const je = await post(periodEnd, `WIP-${tag}`, lines, `BidClaw WIP adjustment for ${periodEnd}`)
    const flipped = lines.map((l) => ({
      ...l,
      JournalEntryLineDetail: { ...l.JournalEntryLineDetail, PostingType: l.JournalEntryLineDetail.PostingType === 'Debit' ? 'Credit' : 'Debit' },
    }))
    const rev = await post(reversalDate, `WIP-${tag}-R`, flipped, `Reversal of BidClaw WIP adjustment for ${periodEnd}`)

    await service
      .from('wip_periods')
      .update({ qbo_journal_id: String(je.Id), qbo_reversal_id: String(rev.Id), qbo_posted_at: new Date().toISOString(), qbo_sync_error: null })
      .eq('id', periodId)
    await service.from('qbo_connections').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('user_id', userId)
    await log(service, userId, { kind: 'journal', entity_id: periodId, qbo_id: String(je.Id), status: 'ok' })
    return { ok: true, journal_id: String(je.Id), reversal_id: String(rev.Id), lines: lines.length, reversal_date: reversalDate }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await service.from('wip_periods').update({ qbo_sync_error: msg }).eq('id', periodId)
    await log(service, userId, { kind: 'journal', entity_id: periodId, status: 'error', message: msg })
    throw err
  }
}

/**
 * The QuickBooks customer for this BidClaw customer: the remembered id if
 * it still exists, else a match on DisplayName, else a new one. The id
 * is written back so the next push skips the lookup.
 */
async function ensureCustomer(service: SupabaseClient, userId: string, conn: Connection, customer: Row): Promise<string> {
  if (customer.qbo_customer_id) {
    try {
      const found = await qbo<Row>(conn, `/customer/${customer.qbo_customer_id}`)
      if (found?.Customer?.Id) return String(found.Customer.Id)
    } catch {
      /* fall through: it was deleted or merged over there */
    }
  }
  const name = String(customer.name ?? '').trim().slice(0, 100)
  if (!name) throw new Error('The customer has no name.')

  const existing = await qbo<Row>(conn, '/query', {
    query: { query: `select Id, DisplayName from Customer where DisplayName = '${q(name)}'` },
  })
  let id: string | null = existing?.QueryResponse?.Customer?.[0]?.Id ? String(existing.QueryResponse.Customer[0].Id) : null

  if (!id) {
    const created = await qbo<Row>(conn, '/customer', {
      method: 'POST',
      body: {
        DisplayName: name,
        PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
        PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
        BillAddr:
          customer.billing_address_line1 || customer.billing_address_city
            ? {
                Line1: customer.billing_address_line1 ?? undefined,
                City: customer.billing_address_city ?? undefined,
                CountrySubDivisionCode: customer.billing_address_state ?? undefined,
                PostalCode: customer.billing_address_zip ?? undefined,
              }
            : undefined,
      },
    })
    id = String(created.Customer.Id)
    await log(service, userId, { kind: 'customer', entity_id: customer.id, qbo_id: id, status: 'ok' })
  }
  await service.from('customers').update({ qbo_customer_id: id }).eq('id', customer.id)
  return id
}
