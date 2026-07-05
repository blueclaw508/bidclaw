// Client data layer for Jamie (AI estimating agent, Phase 1).
//
// Thin wrapper over the `jamie-estimate` edge function: it does the KYN
// reasoning server-side and returns a structured estimate. Here we just
// invoke it, surface friendly errors (including the paid-upgrade gate),
// and map Jamie's categories to the DB enum. The actual line INSERT goes
// through the existing addWorkAreaLinesBulk (RLS-safe) at the call site.

import { supabase } from '@/lib/supabase'
import type { ProposalLineCategory } from '@/lib/types'

/** One line Jamie returns. Categories are title-case (her contract). */
export interface JamieLineItem {
  name: string
  qty: number
  unit: string
  category: 'Materials' | 'Equipment' | 'Labor' | 'Subcontractor' | 'Other'
  /** BASE cost per unit (materials/sub/other) or $/hr (labor/equipment). 0 = unpriced. */
  unit_cost: number
}

export interface JamieResult {
  scope_description: string
  line_items: JamieLineItem[]
  gap_questions: string[]
  new_catalog_items: string[]
}

/** Thrown when the company isn't entitled to Jamie (paid upgrade). */
export class JamieNotEnabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JamieNotEnabledError'
  }
}

const CATEGORY_MAP: Record<JamieLineItem['category'], ProposalLineCategory> = {
  Materials: 'material',
  Equipment: 'equipment',
  Labor: 'labor',
  Subcontractor: 'subcontractor',
  Other: 'other',
}

/** Map Jamie's title-case category to the work_area_lines DB enum. */
export function jamieCategoryToDb(c: string): ProposalLineCategory {
  return CATEGORY_MAP[c as JamieLineItem['category']] ?? 'other'
}

/**
 * Ask Jamie to build a priced estimate for one work area. Throws
 * JamieNotEnabledError when the account isn't upgraded, or a plain Error
 * with Jamie's message on any other failure.
 */
export async function askJamie(input: {
  workAreaId: string
  workAreaName: string
  scope: string
  image?: { media_type: string; data: string } | null
}): Promise<JamieResult> {
  const { data, error } = await supabase.functions.invoke('jamie-estimate', {
    body: input,
  })

  if (error) {
    let message = 'Jamie hit a snag. Try again.'
    let code: string | undefined
    // FunctionsHttpError carries the raw Response on `.context`.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const respBody = await ctx.json()
        if (respBody?.error) message = respBody.error
        code = respBody?.code
      } catch {
        /* fall through to default message */
      }
    } else if (error.message) {
      message = error.message
    }
    if (code === 'jamie_not_enabled') throw new JamieNotEnabledError(message)
    throw new Error(message)
  }

  return data as JamieResult
}

/** Encode an image File into the base64 payload the function expects. */
export async function fileToImagePayload(
  file: File
): Promise<{ media_type: string; data: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return { media_type: file.type, data: btoa(binary) }
}
