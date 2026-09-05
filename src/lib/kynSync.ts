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
}

export interface KynImportPlan {
  division: string
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
  markupMaterials: number | null
  markupSubs: number | null
  /** Markups KYN carries that BidClaw has nowhere to store. Shown, not hidden. */
  unmappedMarkups: Record<string, number>
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
export function loadKynCatalogue(): Promise<{ catalogue: KynModelSummary[] }> {
  return call({ mode: 'preview' })
}

/** What exactly would land, if they imported this division? Writes nothing. */
export function previewKynImport(
  year: number,
  division: number
): Promise<{ catalogue: KynModelSummary[]; plan: KynImportPlan }> {
  return call({ mode: 'preview', year, division })
}

/** Do it. Overwrites matching rows and appends the rest; deletes nothing. */
export function applyKynImport(
  year: number,
  division: number
): Promise<{ applied: boolean; plan: KynImportPlan }> {
  return call({ mode: 'apply', year, division })
}
