import { supabase } from '@/lib/supabase'
import { lineTotal, roundMoney, sumMoney } from '@/lib/money'
import type {
  ChangeOrder,
  ChangeOrderStatus,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  InvoiceWithDetails,
  PaymentMethod,
  PaymentMilestone,
  ProposalWithWorkAreas,
} from '@/lib/types'

/* ============================================================
 * Invoicing (migration 0044) — data layer.
 *
 * Totals are trigger-maintained; nothing here writes subtotal, total,
 * or amount_paid. Every write goes through RLS as the owner.
 * ============================================================ */

/** "INV-0007". The prefix is the company's; the number is the row's. */
export function formatInvoiceNumber(prefix: string | null | undefined, n: number): string {
  return `${prefix ?? 'INV-'}${String(n).padStart(4, '0')}`
}

export function invoiceBalance(inv: Pick<Invoice, 'total' | 'amount_paid'>): number {
  return roundMoney(Number(inv.total) - Number(inv.amount_paid))
}

/** Sent, unpaid, and past its due date. Derived, never stored. */
export function isInvoiceOverdue(inv: Pick<Invoice, 'status' | 'due_date'>, today = new Date()): boolean {
  if (inv.status !== 'sent' || !inv.due_date) return false
  const due = new Date(inv.due_date + 'T23:59:59')
  return due.getTime() < today.getTime()
}

/** The invoice gate is a Postgres trigger; its name arrives verbatim. */
export function isInvoiceGateError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('subscription_required_to_invoice')
}

export const INVOICE_GATE_REASON =
  'Subscribe to send invoices. Your proposals and estimates are untouched — invoicing is part of Pro.'

// PostgREST returns numeric columns as strings in some client versions.
// Coerce once at the boundary so the UI never does arithmetic on text.
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function shapeInvoice<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    subtotal: num(row.subtotal),
    total: num(row.total),
    amount_paid: num(row.amount_paid),
    milestone_percent: row.milestone_percent === null || row.milestone_percent === undefined ? null : num(row.milestone_percent),
  }
}
function shapeLine(row: Record<string, unknown>): InvoiceLine {
  return {
    ...(row as unknown as InvoiceLine),
    quantity: num(row.quantity),
    unit_price: num(row.unit_price),
    amount: num(row.amount),
  }
}
function shapePayment(row: Record<string, unknown>): InvoicePayment {
  return { ...(row as unknown as InvoicePayment), amount: num(row.amount) }
}

/* ---------- read ---------- */

export async function listInvoicesByProject(projectId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('project_id', projectId)
    .order('invoice_number', { ascending: false })
  if (error) throw new Error(`Couldn't load invoices: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => shapeInvoice(r) as unknown as Invoice)
}

export async function getInvoice(id: string): Promise<InvoiceWithDetails | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_lines ( * ), invoice_payments ( * )')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load invoice: ${error.message}`)
  if (!data) return null
  const raw = data as Record<string, unknown> & {
    invoice_lines: Record<string, unknown>[]
    invoice_payments: Record<string, unknown>[]
  }
  const { invoice_lines, invoice_payments, ...core } = raw
  return {
    ...(shapeInvoice(core) as unknown as Invoice),
    lines: (invoice_lines ?? [])
      .map(shapeLine)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    payments: (invoice_payments ?? [])
      .map(shapePayment)
      .sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at)),
  }
}

/**
 * How much of a proposal's schedule has been billed, as a percent, over
 * every non-void invoice that came from a milestone. Custom invoices on
 * the same proposal carry no percent and are not counted here.
 */
export async function invoicedPercentForProposal(proposalId: string): Promise<number> {
  const { data, error } = await supabase
    .from('invoices')
    .select('milestone_percent, status')
    .eq('proposal_id', proposalId)
    .neq('status', 'void')
  if (error) throw new Error(`Couldn't load invoices: ${error.message}`)
  return roundMoney(
    ((data ?? []) as Array<{ milestone_percent: unknown }>).reduce(
      (s, r) => s + num(r.milestone_percent),
      0
    )
  )
}

/* ---------- build lines from a proposal ---------- */

export interface NewInvoiceLine {
  description: string
  quantity: number
  unit_price: number
  proposal_work_area_id?: string | null
  change_order_id?: string | null
}

/**
 * One line per enabled work area at `percent` of that area's price, with
 * the cents reconciled so the lines add up to exactly round(total × pct).
 * That allocation is what the WIP schedule (step 4) reads back.
 */
export function buildMilestoneLines(
  proposal: ProposalWithWorkAreas,
  milestone: PaymentMilestone
): NewInvoiceLine[] {
  const pct = Number(milestone.percent)
  const areas = proposal.work_areas.filter((wa) => wa.enabled)
  const areaTotals = areas.map((wa) => sumMoney(wa.lines.map((l) => lineTotal(l))))
  const grand = sumMoney(areaTotals)
  const target = roundMoney((grand * pct) / 100)

  const lines: NewInvoiceLine[] = areas.map((wa, i) => ({
    description: `${wa.resolved_name} — ${formatPercent(pct)} (${milestone.description})`,
    quantity: 1,
    unit_price: roundMoney((areaTotals[i] * pct) / 100),
    proposal_work_area_id: wa.id,
  }))

  // Reconcile rounding dust onto the largest line so the invoice total is
  // exactly the milestone of the proposal total.
  const dust = roundMoney(target - sumMoney(lines.map((l) => l.unit_price)))
  if (dust !== 0 && lines.length > 0) {
    let idx = 0
    for (let i = 1; i < lines.length; i++) if (lines[i].unit_price > lines[idx].unit_price) idx = i
    lines[idx].unit_price = roundMoney(lines[idx].unit_price + dust)
  }
  return lines.filter((l) => l.unit_price !== 0)
}

export function changeOrderLine(co: ChangeOrder): NewInvoiceLine {
  return {
    description: `Change order #${co.change_number}: ${co.title}`,
    quantity: 1,
    unit_price: num(co.amount),
    change_order_id: co.id,
  }
}

function formatPercent(pct: number): string {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

/* ---------- write ---------- */

export async function createInvoice(input: {
  projectId: string
  proposalId?: string | null
  milestoneLabel?: string | null
  milestonePercent?: number | null
  issueDate?: string
  dueDate?: string | null
  notes?: string | null
  terms?: string | null
  lines: NewInvoiceLine[]
}): Promise<string> {
  // user_id is set by the insert trigger from the project's owner; RLS
  // then checks it against auth.uid(). Sending a placeholder keeps the
  // NOT NULL constraint happy before the trigger runs.
  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      user_id: me.user?.id,
      project_id: input.projectId,
      proposal_id: input.proposalId ?? null,
      milestone_label: input.milestoneLabel ?? null,
      milestone_percent: input.milestonePercent ?? null,
      issue_date: input.issueDate ?? undefined,
      due_date: input.dueDate ?? undefined,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const id = (data as { id: string }).id

  if (input.lines.length > 0) {
    const { error: lErr } = await supabase.from('invoice_lines').insert(
      input.lines.map((l, i) => ({
        invoice_id: id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        proposal_work_area_id: l.proposal_work_area_id ?? null,
        change_order_id: l.change_order_id ?? null,
        sort_order: i,
      }))
    )
    if (lErr) {
      // Do not leave a numbered, empty invoice behind.
      await supabase.from('invoices').delete().eq('id', id)
      throw new Error(`Couldn't write invoice lines: ${lErr.message}`)
    }
  }
  return id
}

export type InvoicePatch = Partial<
  Pick<Invoice, 'status' | 'issue_date' | 'due_date' | 'notes' | 'terms' | 'milestone_label' | 'milestone_percent'>
>

export async function updateInvoice(id: string, patch: InvoicePatch): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return shapeInvoice(data as Record<string, unknown>) as unknown as Invoice
}

export async function deleteInvoice(id: string): Promise<void> {
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Replace the line set: upsert what is given, delete what is missing. */
export async function saveInvoiceLines(
  invoiceId: string,
  lines: Array<NewInvoiceLine & { id?: string }>
): Promise<void> {
  const keep = lines.filter((l) => l.id).map((l) => l.id as string)
  const del = supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId)
  const { error: dErr } = keep.length > 0 ? await del.not('id', 'in', `(${keep.join(',')})`) : await del
  if (dErr) throw new Error(dErr.message)

  const rows = lines.map((l, i) => ({
    ...(l.id ? { id: l.id } : {}),
    invoice_id: invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    proposal_work_area_id: l.proposal_work_area_id ?? null,
    change_order_id: l.change_order_id ?? null,
    sort_order: i,
  }))
  if (rows.length === 0) return
  const { error } = await supabase.from('invoice_lines').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function addPayment(input: {
  invoiceId: string
  amount: number
  paidOn: string
  method: PaymentMethod
  reference?: string | null
  notes?: string | null
}): Promise<InvoicePayment> {
  const { data, error } = await supabase
    .from('invoice_payments')
    .insert({
      invoice_id: input.invoiceId,
      amount: input.amount,
      paid_on: input.paidOn,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return shapePayment(data as Record<string, unknown>)
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from('invoice_payments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ---------- change orders ---------- */

export async function listChangeOrders(projectId: string): Promise<ChangeOrder[]> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('project_id', projectId)
    .order('change_number', { ascending: true })
  if (error) throw new Error(`Couldn't load change orders: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(
    (r) => ({ ...(r as unknown as ChangeOrder), amount: num(r.amount) })
  )
}

export async function createChangeOrder(input: {
  projectId: string
  proposalId?: string | null
  title: string
  description?: string | null
  amount: number
  status?: ChangeOrderStatus
}): Promise<ChangeOrder> {
  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('change_orders')
    .insert({
      user_id: me.user?.id,
      project_id: input.projectId,
      proposal_id: input.proposalId ?? null,
      title: input.title,
      description: input.description ?? null,
      amount: input.amount,
      status: input.status ?? 'draft',
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const r = data as Record<string, unknown>
  return { ...(r as unknown as ChangeOrder), amount: num(r.amount) }
}

export async function updateChangeOrder(
  id: string,
  patch: Partial<Pick<ChangeOrder, 'title' | 'description' | 'amount' | 'status' | 'proposal_id'>>
): Promise<ChangeOrder> {
  const { data, error } = await supabase
    .from('change_orders')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const r = data as Record<string, unknown>
  return { ...(r as unknown as ChangeOrder), amount: num(r.amount) }
}

export async function deleteChangeOrder(id: string): Promise<void> {
  const { error } = await supabase.from('change_orders').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Change orders already carried on a non-void invoice line. */
export async function invoicedChangeOrderIds(projectId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('invoice_lines')
    .select('change_order_id, invoice:invoices!inner ( project_id, status )')
    .eq('invoice.project_id', projectId)
    .neq('invoice.status', 'void')
    .not('change_order_id', 'is', null)
  if (error) throw new Error(error.message)
  return new Set(
    ((data ?? []) as Array<{ change_order_id: string | null }>)
      .map((r) => r.change_order_id)
      .filter((v): v is string => !!v)
  )
}
