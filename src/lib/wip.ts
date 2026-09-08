import { supabase } from '@/lib/supabase'
import { roundMoney } from '@/lib/money'
import type { WipEntry, WipPeriod } from '@/lib/types'

/* ============================================================
 * WIP (migration 0046) — data layer.
 * ============================================================ */

/** Last day of the month containing `d`, as YYYY-MM-DD in local time. */
export function monthEnd(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
}

/** "2026-09" → month end of that month. */
export function monthEndOf(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  return monthEnd(new Date(y, m - 1, 1))
}

/** YYYY-MM-DD → "September 2026". */
export function periodLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export interface WipEntryRow extends WipEntry {
  project_name: string
}

/** Build or refresh the period from live data. Returns the period id. */
export async function snapshotPeriod(periodEnd: string): Promise<string> {
  const { data, error } = await supabase.rpc('wip_snapshot', { p_period_end: periodEnd })
  if (error) throw new Error(error.message)
  return data as string
}

export async function listPeriods(): Promise<WipPeriod[]> {
  const { data, error } = await supabase.from('wip_periods').select('*').order('period_end', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WipPeriod[]
}

export async function getPeriod(id: string): Promise<{ period: WipPeriod; entries: WipEntryRow[] } | null> {
  const [{ data: period, error: pErr }, { data: entries, error: eErr }] = await Promise.all([
    supabase.from('wip_periods').select('*').eq('id', id).maybeSingle(),
    supabase.from('wip_entries').select('*, project:projects ( name )').eq('period_id', id),
  ])
  if (pErr) throw new Error(pErr.message)
  if (eErr) throw new Error(eErr.message)
  if (!period) return null
  const rows = ((entries ?? []) as Array<Record<string, unknown> & { project: { name: string } | null }>).map((r) => ({
    ...(r as unknown as WipEntry),
    contract_value: num(r.contract_value),
    percent_complete: num(r.percent_complete),
    billed_to_date: num(r.billed_to_date),
    earned: num(r.earned),
    over_under: num(r.over_under),
    project_name: r.project?.name ?? 'Project',
  }))
  rows.sort(
    (a, b) =>
      a.project_name.localeCompare(b.project_name) ||
      (a.change_order_id ? 1 : 0) - (b.change_order_id ? 1 : 0) ||
      a.label.localeCompare(b.label)
  )
  return { period: period as WipPeriod, entries: rows }
}

export async function setPercentComplete(entryId: string, percent: number): Promise<WipEntry> {
  const pct = Math.min(100, Math.max(0, roundMoney(percent)))
  const { data, error } = await supabase
    .from('wip_entries')
    .update({ percent_complete: pct })
    .eq('id', entryId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const r = data as Record<string, unknown>
  return {
    ...(r as unknown as WipEntry),
    contract_value: num(r.contract_value),
    percent_complete: num(r.percent_complete),
    billed_to_date: num(r.billed_to_date),
    earned: num(r.earned),
    over_under: num(r.over_under),
  }
}

export async function closePeriod(id: string): Promise<void> {
  const { error } = await supabase
    .from('wip_periods')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function reopenPeriod(id: string): Promise<void> {
  const { error } = await supabase
    .from('wip_periods')
    .update({ status: 'open', closed_at: null })
    .eq('id', id)
    .is('qbo_journal_id', null)
  if (error) throw new Error(error.message)
}

export function isPeriodClosedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('wip_period_closed')
}
