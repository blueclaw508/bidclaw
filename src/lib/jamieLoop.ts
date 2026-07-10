// Data layer for the Jamie LOOP (J0) — the conversational, staged,
// two-gate estimating agent. Distinct from jamie.ts (Phase-1 single-shot
// jamie-estimate flow, kept live until J6 supersedes it).
//
// Conventions match proposals.ts / leads.ts:
//   • Throw on error (callers handle with toast / state)
//   • RLS scopes reads to the current user; inserts carry user_id where
//     the table has one
//
// Drift-gate reconciliation (Ian, 2026-07-10): runs anchor to PROJECTS —
// BidClaw is estimate-first, so approved staged content commits into
// work_areas / work_area_lines through the existing estimate data layer
// (J4/J6), never into proposals directly.

import { supabase } from '@/lib/supabase'
import {
  evaluateFounderModeGate,
  isLegalRunTransition,
  FOUNDER_USER_ID,
  type JamieGateResult,
  type JamieRunStatus,
  type JamieUsage,
  type TierLimits,
} from '@/lib/jamieGate'

export type {
  JamieGateCode,
  JamieGateResult,
  JamieRunStatus,
  TierLimits,
} from '@/lib/jamieGate'
export { FOUNDER_USER_ID } from '@/lib/jamieGate'

// ──────────────────────────────────────────────────────────────────────
// Row types
// ──────────────────────────────────────────────────────────────────────

export interface JamieLoopRun {
  id: string
  user_id: string
  project_id: string
  status: JamieRunStatus
  input_summary: string | null
  image_count: number
  chat_turn_count: number
  error_detail: string | null
  created_at: string
  updated_at: string
}

export type JamieMessageRole = 'user' | 'assistant'

/**
 * Message content blocks — text plus IMAGE STORAGE REFS (path into the
 * private jamie-images bucket, J1), never raw base64.
 */
export interface JamieMessageContent {
  text?: string
  image_refs?: string[]
}

export interface JamieMessage {
  id: string
  jamie_run_id: string
  role: JamieMessageRole
  content: JamieMessageContent
  created_at: string
}

export type JamieStagedStatus = 'pending' | 'approved' | 'rejected'

export interface JamieProposedWorkArea {
  id: string
  jamie_run_id: string
  status: JamieStagedStatus
  proposed_name: string
  proposed_description: string | null
  source_work_area_id: string | null
  inserted_work_area_id: string | null
  sort_order: number
}

export type JamieLineCategory =
  | 'labor'
  | 'material'
  | 'equipment'
  | 'subcontractor'
  | 'other'

export interface JamieProposedLine {
  id: string
  jamie_proposed_work_area_id: string
  status: JamieStagedStatus
  category: JamieLineCategory
  label: string
  unit: string | null
  quantity: number | null
  unit_cost: number | null
  kit_id: string | null
  catalog_item_id: string | null
  reasoning: string | null
  needs_pricing: boolean
  inserted_work_area_line_id: string | null
  sort_order: number
}

export interface JamieRunDetail extends JamieLoopRun {
  proposed_work_areas: Array<
    JamieProposedWorkArea & { proposed_lines: JamieProposedLine[] }
  >
}

export type JamieInvocationOutcome =
  | 'in_progress'
  | 'committed'
  | 'rejected'
  | 'abandoned'
  | 'error'

// ──────────────────────────────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────────────────────────────

export async function createJamieRun(projectId: string): Promise<JamieLoopRun> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const { data, error } = await supabase
    .from('jamie_loop_runs')
    .insert({ user_id: user.id, project_id: projectId })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't start a Jamie session: ${error?.message ?? 'no row returned'}`)
  }
  return data as JamieLoopRun
}

/** Load one run with its staged WAs + lines (ordered). Null if not yours. */
export async function getJamieRun(id: string): Promise<JamieRunDetail | null> {
  const { data, error } = await supabase
    .from('jamie_loop_runs')
    .select(
      `*,
       proposed_work_areas:jamie_proposed_work_areas (
         *,
         proposed_lines:jamie_proposed_lines (*)
       )`
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load Jamie session: ${error.message}`)
  if (!data) return null
  const detail = data as JamieRunDetail
  detail.proposed_work_areas.sort((a, b) => a.sort_order - b.sort_order)
  for (const wa of detail.proposed_work_areas) {
    wa.proposed_lines.sort((a, b) => a.sort_order - b.sort_order)
  }
  return detail
}

/** Latest non-terminal run on a project — panel resume (J2). */
export async function getActiveJamieRun(
  projectId: string
): Promise<JamieLoopRun | null> {
  const { data, error } = await supabase
    .from('jamie_loop_runs')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['in_progress', 'awaiting_wa_approval', 'awaiting_line_approval'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Couldn't check for a Jamie session: ${error.message}`)
  return (data as JamieLoopRun) ?? null
}

/**
 * Advance the run lifecycle. Guards against illegal jumps (e.g.
 * committed → in_progress) — those throw rather than silently corrupt
 * the loop state.
 */
export async function setRunStatus(
  runId: string,
  status: JamieRunStatus,
  errorDetail?: string
): Promise<JamieLoopRun> {
  const { data: current, error: loadErr } = await supabase
    .from('jamie_loop_runs')
    .select('status')
    .eq('id', runId)
    .single()
  if (loadErr || !current) {
    throw new Error(`Couldn't load Jamie session: ${loadErr?.message ?? 'not found'}`)
  }
  const from = current.status as JamieRunStatus
  if (from !== status && !isLegalRunTransition(from, status)) {
    throw new Error(`Illegal Jamie run transition: ${from} → ${status}.`)
  }
  const { data, error } = await supabase
    .from('jamie_loop_runs')
    .update({ status, error_detail: errorDetail ?? null })
    .eq('id', runId)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update Jamie session: ${error?.message ?? 'no row returned'}`)
  }
  return data as JamieLoopRun
}

// ──────────────────────────────────────────────────────────────────────
// Messages
// ──────────────────────────────────────────────────────────────────────

export async function listJamieMessages(runId: string): Promise<JamieMessage[]> {
  const { data, error } = await supabase
    .from('jamie_messages')
    .select('*')
    .eq('jamie_run_id', runId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Couldn't load the conversation: ${error.message}`)
  return (data ?? []) as JamieMessage[]
}

export async function appendJamieMessage(
  runId: string,
  role: JamieMessageRole,
  content: JamieMessageContent
): Promise<JamieMessage> {
  const { data, error } = await supabase
    .from('jamie_messages')
    .insert({ jamie_run_id: runId, role, content })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save the message: ${error?.message ?? 'no row returned'}`)
  }
  return data as JamieMessage
}

// ──────────────────────────────────────────────────────────────────────
// Staging
// ──────────────────────────────────────────────────────────────────────

export interface ProposedWorkAreaInput {
  proposed_name: string
  proposed_description?: string | null
  source_work_area_id?: string | null
}

export async function stageProposedWorkAreas(
  runId: string,
  proposals: ProposedWorkAreaInput[]
): Promise<JamieProposedWorkArea[]> {
  if (proposals.length === 0) return []
  const rows = proposals.map((p, i) => ({
    jamie_run_id: runId,
    proposed_name: p.proposed_name.trim(),
    proposed_description: p.proposed_description?.trim() || null,
    source_work_area_id: p.source_work_area_id ?? null,
    sort_order: i,
  }))
  const { data, error } = await supabase
    .from('jamie_proposed_work_areas')
    .insert(rows)
    .select()
  if (error || !data) {
    throw new Error(`Couldn't stage work areas: ${error?.message ?? 'no rows returned'}`)
  }
  return data as JamieProposedWorkArea[]
}

export interface ProposedLineInput {
  category: JamieLineCategory
  label: string
  unit?: string | null
  quantity?: number | null
  unit_cost?: number | null
  kit_id?: string | null
  catalog_item_id?: string | null
  reasoning?: string | null
  needs_pricing?: boolean
}

export async function stageProposedLines(
  pwaId: string,
  lines: ProposedLineInput[]
): Promise<JamieProposedLine[]> {
  if (lines.length === 0) return []
  const rows = lines.map((l, i) => ({
    jamie_proposed_work_area_id: pwaId,
    category: l.category,
    label: l.label.trim(),
    unit: l.unit?.trim() || null,
    quantity: l.quantity ?? null,
    unit_cost: l.unit_cost ?? null,
    kit_id: l.kit_id ?? null,
    catalog_item_id: l.catalog_item_id ?? null,
    reasoning: l.reasoning?.trim() || null,
    needs_pricing: l.needs_pricing ?? false,
    sort_order: i,
  }))
  const { data, error } = await supabase
    .from('jamie_proposed_lines')
    .insert(rows)
    .select()
  if (error || !data) {
    throw new Error(`Couldn't stage line items: ${error?.message ?? 'no rows returned'}`)
  }
  return data as JamieProposedLine[]
}

// ──────────────────────────────────────────────────────────────────────
// Gate — founder mode (Loop Rule 8) over live COUNT queries
// ──────────────────────────────────────────────────────────────────────

async function loadTierLimits(tier: string): Promise<TierLimits | null> {
  const { data, error } = await supabase
    .from('subscription_tier_limits')
    .select('*')
    .eq('tier', tier)
    .maybeSingle()
  if (error) throw new Error(`Couldn't read plan limits: ${error.message}`)
  return (data as TierLimits) ?? null
}

/** Live usage counts feeding the gate. Direct COUNTs — no materialized view. */
export async function loadJamieUsage(
  userId: string,
  runId?: string
): Promise<JamieUsage> {
  const monthStartUtc = new Date()
  monthStartUtc.setUTCDate(1)
  monthStartUtc.setUTCHours(0, 0, 0, 0)
  const quotaMonth = monthStartUtc.toISOString().slice(0, 10)
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  // Committed Jamie estimates this month — hits idx_jamie_inv_quota. One
  // committed run flips several invocation rows, so count DISTINCT runs.
  const { data: quotaRows, error: quotaErr } = await supabase
    .from('jamie_invocations')
    .select('jamie_run_id')
    .eq('user_id', userId)
    .eq('counts_against_quota', true)
    .eq('quota_month', quotaMonth)
  if (quotaErr) throw new Error(`Couldn't check your Jamie usage: ${quotaErr.message}`)
  const jamieEstimatesThisMonth = new Set(
    (quotaRows ?? []).map((r) => r.jamie_run_id as string)
  ).size

  const { count: invocationsThisMonth, error: totalErr } = await supabase
    .from('jamie_invocations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('quota_month', quotaMonth)
  if (totalErr) throw new Error(`Couldn't check your Jamie usage: ${totalErr.message}`)

  const { count: invocationsLastHour, error: hourErr } = await supabase
    .from('jamie_invocations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('started_at', hourAgo)
  if (hourErr) throw new Error(`Couldn't check your Jamie usage: ${hourErr.message}`)

  let imagesThisSession = 0
  let turnsThisSession = 0
  if (runId) {
    const { data: run, error: runErr } = await supabase
      .from('jamie_loop_runs')
      .select('image_count, chat_turn_count')
      .eq('id', runId)
      .maybeSingle()
    if (runErr) throw new Error(`Couldn't check this Jamie session: ${runErr.message}`)
    imagesThisSession = run?.image_count ?? 0
    turnsThisSession = run?.chat_turn_count ?? 0
  }

  return {
    jamieEstimatesThisMonth,
    invocationsThisMonth: invocationsThisMonth ?? 0,
    invocationsLastHour: invocationsLastHour ?? 0,
    imagesThisSession,
    turnsThisSession,
  }
}

/**
 * The gate. Founder-mode (Loop Rule 8): allow() for Ian's UUID, typed
 * deny for everyone else. Client-side this is a UX PRE-CHECK — J1's Edge
 * Function runs the same evaluation server-side before any API call.
 */
export async function canInvokeJamie(
  userId: string,
  runId?: string
): Promise<JamieGateResult> {
  // Non-founders never reach the count queries — cheap fast deny.
  if (userId !== FOUNDER_USER_ID) {
    return evaluateFounderModeGate(userId, null, EMPTY_USAGE)
  }
  const [limits, usage] = await Promise.all([
    loadTierLimits('founder'),
    loadJamieUsage(userId, runId),
  ])
  return evaluateFounderModeGate(userId, limits, usage)
}

const EMPTY_USAGE: JamieUsage = {
  jamieEstimatesThisMonth: 0,
  invocationsThisMonth: 0,
  invocationsLastHour: 0,
  imagesThisSession: 0,
  turnsThisSession: 0,
}

// ──────────────────────────────────────────────────────────────────────
// Invocation metering
// ──────────────────────────────────────────────────────────────────────

export async function recordInvocation(input: {
  userId: string
  runId: string
  model?: string
  imageCount?: number
  chatTurnNumber?: number
}): Promise<string> {
  const { data, error } = await supabase
    .from('jamie_invocations')
    .insert({
      user_id: input.userId,
      jamie_run_id: input.runId,
      model_used: input.model ?? null,
      image_count: input.imageCount ?? 0,
      chat_turn_number: input.chatTurnNumber ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`Couldn't record the invocation: ${error?.message ?? 'no row returned'}`)
  }
  return data.id as string
}

export async function finalizeInvocation(
  id: string,
  outcome: JamieInvocationOutcome,
  tokens?: {
    input?: number
    output?: number
    cachedInput?: number
  },
  costUsd?: number
): Promise<void> {
  const { error } = await supabase
    .from('jamie_invocations')
    .update({
      ended_at: new Date().toISOString(),
      outcome,
      input_tokens: tokens?.input ?? null,
      output_tokens: tokens?.output ?? null,
      cached_input_tokens: tokens?.cachedInput ?? 0,
      estimated_cost_usd: costUsd ?? null,
    })
    .eq('id', id)
  if (error) throw new Error(`Couldn't finalize the invocation: ${error.message}`)
}
