// Client half of the Know Your Numbers import.
//
// All of the work happens in the kyn-sync edge function: it reads the
// caller's email from their JWT, finds the matching KYN account, and derives
// BidClaw rates from KYN's ownership-cost model using the formula ported
// from kyn-engine. Nothing here decides a number — this module only asks
// and renders the answer.

import { supabase } from '@/lib/supabase'

export interface KynDivisionSummary {
  index: number
  name: string
  crews: number
  equipment: number
}

export interface KynModelSummary {
  year: number
  company_name: string
  updated_at: string
  divisions: KynDivisionSummary[]
}

export interface KynMappedRow {
  name: string
  rate: number
  action?: 'keep' | 'add'
  currentRate?: number | null
}

export interface KynDivisionPlan {
  kynIndex: number
  division: string
  /** True when the import would create this division in BidClaw. */
  isNewDivision: boolean
  labor: {
    incoming: KynMappedRow[]
    overwrites: number
    appends: number
    untouched: number
  }
  equipment: {
    incoming: KynMappedRow[]
    overwrites: number
    appends: number
    untouched: number
  }
  /** This division's own materials / subs markups — kept per division (0040). */
  markups: { materials: number | null; subs: number | null }
  incomingMarkups?: { materials: number | null; subs: number | null }
  /** Markups KYN carries that BidClaw has nowhere to store. Shown, not hidden. */
  unmappedMarkups: Record<string, number>
}

/**
 * The COMPANY-WIDE fallback pair — what a work area with no division prices
 * under. Each imported division keeps its own markups; this is only the
 * default beneath them. The first selected division supplies it, and
 * `fromDivision` names which.
 */
export interface KynMarkupPlan {
  fromDivision: string
  materials: number | null
  subs: number | null
}

export class KynSyncError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('kyn-sync', { body })
  if (error) {
    // The function's own message is far more useful than "non-2xx status",
    // and it is the one that names WHY — no KYN account, no model, not
    // configured — so dig it out of the response when it is there.
    let msg = error.message
    let code: string | undefined
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string; code?: string }
        if (payload?.error) msg = payload.error
        code = payload?.code
      } catch {
        /* keep the transport message */
      }
    }
    throw new KynSyncError(msg, code)
  }
  return data as T
}

/** What KYN models does this contractor have? Writes nothing. */
export interface KynImportHistory { imported_at: string; source: { year:number; company:string; updated_at:string }; divisions: KynDivisionPlan[] }
export function loadKynCatalogue(): Promise<{ catalogue: KynModelSummary[]; imports?: KynImportHistory[] }> {
  return call({ mode: 'preview' })
}

/** What exactly would land, for these divisions? Writes nothing. */
export function previewKynImport(
  year: number,
  divisions: number[]
): Promise<{
  catalogue: KynModelSummary[]
  previewToken: string
  source: {year:number;company:string;updated_at:string}
  plans: KynDivisionPlan[]
  markupPlan: KynMarkupPlan
}> {
  return call({ mode: 'preview', year, divisions })
}

/**
 * Apply the exact preview. Creates missing divisions/rates and preserves
 * existing rates and markups. Deletes nothing — kit lines point at
 * these rows, so a full replace would unlink kits already built.
 */
export function applyKynImport(
  year: number,
  divisions: number[],
  previewToken: string
): Promise<{
  applied: boolean
  plans: KynDivisionPlan[]
  markupPlan: KynMarkupPlan
}> {
  return call({ mode: 'apply', year, divisions, previewToken })
}
