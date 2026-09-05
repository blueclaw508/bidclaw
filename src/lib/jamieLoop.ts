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
  evaluateJamieGate,
  tierIncludesJamie,
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
  /** CLIENT scope from Pass 2 (JAMIE-FLOW 4a). Null on Gate 1 rows. */
  proposed_client_description: string | null
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
  proposals: ProposedWorkAreaInput[],
  /** First sort_order to use — rows added after Jamie's own sit after them. */
  sortOrderStart = 0
): Promise<JamieProposedWorkArea[]> {
  if (proposals.length === 0) return []
  const rows = proposals.map((p, i) => ({
    jamie_run_id: runId,
    proposed_name: p.proposed_name.trim(),
    proposed_description: p.proposed_description?.trim() || null,
    source_work_area_id: p.source_work_area_id ?? null,
    sort_order: sortOrderStart + i,
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
  lines: ProposedLineInput[],
  /** First sort_order to use — contractor-added lines sit after Jamie's. */
  sortOrderStart = 0
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
    sort_order: sortOrderStart + i,
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

/**
 * Tier limits for the CURRENT user — founder resolves to the founder tier
 * (all-NULL = unlimited); everyone else resolves through their
 * company_settings.plan (plan names match tier keys since J0). The panel
 * uses this for the photo-count indicator ("4 of 10 photos"); a NULL
 * images limit renders without a cap.
 */
export async function getMyTierLimits(userId: string): Promise<TierLimits | null> {
  if (userId === FOUNDER_USER_ID) return loadTierLimits('founder')
  const { data } = await supabase
    .from('company_settings')
    .select('plan')
    .maybeSingle()
  return loadTierLimits((data?.plan as string) ?? 'free')
}

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
 * The gate. Resolves the caller's TIER and evaluates their live usage
 * against it. Client-side this is a UX PRE-CHECK — the Edge Function runs
 * the same evaluation server-side before any API call, so a user who edits
 * this result in devtools gains nothing.
 *
 * Until Stripe shipped this was founder-mode: allow Ian, deny everyone
 * else. Leaving it that way would have meant a Pro + AI subscriber paying
 * $499 and then being refused by their own app.
 */
export async function canInvokeJamie(
  userId: string,
  runId?: string
): Promise<JamieGateResult> {
  const limits = await getMyTierLimits(userId)
  // A tier that does not include Jamie can never pass, whatever the counts
  // say — deny before spending four aggregate queries to reach the same
  // answer. This is what keeps a free contractor's project page cheap.
  if (!tierIncludesJamie(limits)) {
    return evaluateJamieGate(limits, EMPTY_USAGE)
  }
  const usage = await loadJamieUsage(userId, runId)
  return evaluateJamieGate(limits, usage)
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

// ──────────────────────────────────────────────────────────────────────
// Gates (J3) — the staged → real commit path
//
// The edge function only ever writes STAGING rows. Both gates commit from
// the browser under the user's own RLS, the same way commitIngestedProposal
// does for reverse ingestion. Rejected staging rows are RETAINED (J0: audit
// trail, never deleted) — they just never become real rows.
// ──────────────────────────────────────────────────────────────────────

/** Gate 1 review payload: one entry per staged work area. */
export interface WorkAreaDecision {
  id: string
  approved: boolean
  /** Contractor's edit of Jamie's name, if they changed it. */
  name: string
  description: string | null
}

/**
 * Commit Gate 1. Approved staged work areas become real `work_areas` rows
 * appended after whatever the project already has; rejected ones are marked
 * and left in place. Returns the ids of the work areas that were created.
 *
 * Jamie is additive-only — `source_work_area_id` (her "this looks like your
 * existing X" flag) is deliberately NOT acted on here. If the contractor
 * agrees it is a duplicate they reject the proposal; we never touch the row
 * they made themselves.
 */
export async function commitWorkAreaGate(
  runId: string,
  decisions: WorkAreaDecision[]
): Promise<string[]> {
  const approved = decisions.filter((d) => d.approved)
  const rejected = decisions.filter((d) => !d.approved)

  const { data: runRow, error: runErr } = await supabase
    .from('jamie_loop_runs')
    .select('project_id')
    .eq('id', runId)
    .single()
  if (runErr || !runRow) {
    throw new Error(`Couldn't load the Jamie session: ${runErr?.message ?? 'not found'}`)
  }
  const projectId = runRow.project_id as string

  // Append after the contractor's existing work areas — never renumber them.
  const { data: existing } = await supabase
    .from('work_areas')
    .select('sequence_order')
    .eq('project_id', projectId)
    .order('sequence_order', { ascending: false })
    .limit(1)
  let nextOrder = ((existing?.[0]?.sequence_order as number) ?? -1) + 1

  const createdIds: string[] = []
  for (const d of approved) {
    const { data: waRow, error: waErr } = await supabase
      .from('work_areas')
      .insert({
        project_id: projectId,
        name: d.name.trim(),
        description: d.description?.trim() || null,
        sequence_order: nextOrder++,
      })
      .select('id')
      .single()
    if (waErr || !waRow) {
      throw new Error(`Couldn't create work area "${d.name}": ${waErr?.message ?? 'no row'}`)
    }
    const waId = waRow.id as string
    createdIds.push(waId)
    const { error: stampErr } = await supabase
      .from('jamie_proposed_work_areas')
      .update({ status: 'approved', inserted_work_area_id: waId })
      .eq('id', d.id)
    if (stampErr) throw new Error(`Couldn't record the approval: ${stampErr.message}`)
  }

  if (rejected.length > 0) {
    const { error: rejErr } = await supabase
      .from('jamie_proposed_work_areas')
      .update({ status: 'rejected' })
      .in(
        'id',
        rejected.map((r) => r.id)
      )
    if (rejErr) throw new Error(`Couldn't record the rejections: ${rejErr.message}`)
  }

  // Back to in_progress: Pass 2 needs a run it is allowed to write to.
  await setRunStatus(runId, 'in_progress')
  return createdIds
}

/**
 * Approved work areas on this run that still have NO staged lines — i.e. the
 * part of the takeoff Pass 2 has not built yet.
 *
 * Pass 2 is chunked (2026-09-04) because pricing every work area in one
 * request blew past the edge function's 150s wall clock and died silently.
 * This is what the workspace walks through, and what tells it a takeoff was
 * left half-built — a Pass 2 that died used to leave the contractor in chat
 * with no way to resume, and re-proposing was the only button that did
 * anything. Ordered so the takeoff is built in the order the contractor
 * approved.
 */
export async function listWorkAreasAwaitingLines(
  runId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data: approved, error } = await supabase
    .from('jamie_proposed_work_areas')
    .select('id, proposed_name, sort_order, inserted_work_area_id')
    .eq('jamie_run_id', runId)
    .eq('status', 'approved')
    .not('inserted_work_area_id', 'is', null)
    .order('sort_order')
  if (error) throw new Error(`Couldn't read the approved work areas: ${error.message}`)
  const rows = (approved ?? []) as Array<{ id: string; proposed_name: string }>
  if (rows.length === 0) return []

  const { data: lines, error: lineErr } = await supabase
    .from('jamie_proposed_lines')
    .select('jamie_proposed_work_area_id')
    .in('jamie_proposed_work_area_id', rows.map((r) => r.id))
  if (lineErr) throw new Error(`Couldn't read the staged lines: ${lineErr.message}`)
  const priced = new Set(
    ((lines ?? []) as Array<{ jamie_proposed_work_area_id: string }>).map(
      (l) => l.jamie_proposed_work_area_id
    )
  )
  return rows
    .filter((r) => !priced.has(r.id))
    .map((r) => ({ id: r.id, name: r.proposed_name }))
}

/**
 * What Pass 2 reads as the scope of a work area the contractor added at
 * Gate 1 without describing it. The staged row needs SOME scope text or the
 * prompt shows "(none)" and Jamie has nothing to build from; the real
 * work_areas row stays blank until Pass 2 writes the scope from the takeoff.
 */
const CONTRACTOR_ADDED_SCOPE =
  'Added by the contractor at Gate 1 with no scope text. Build this work area from its name and everything in the conversation.'

/**
 * Gate 1 inline add (Ian's spec: add, edit, delete — not just approve).
 * The contractor typed a work area Jamie missed. It is staged on the run
 * exactly like one of hers so the commit path and Pass 2 treat it the
 * same: it becomes a real work area now and gets PRICED in the takeoff.
 * Returns ready-to-commit decisions, all approved.
 */
export async function stageContractorWorkAreas(
  runId: string,
  added: Array<{ name: string; description: string }>,
  /** How many staged rows the run already carries — added ones sort after. */
  afterCount: number
): Promise<WorkAreaDecision[]> {
  const clean = added.filter((a) => a.name.trim())
  if (clean.length === 0) return []
  const staged = await stageProposedWorkAreas(
    runId,
    clean.map((a) => ({
      proposed_name: a.name,
      proposed_description: a.description.trim() || CONTRACTOR_ADDED_SCOPE,
    })),
    afterCount
  )
  return staged.map((s, i) => ({
    id: s.id,
    approved: true,
    name: clean[i].name.trim(),
    // The REAL work area gets only what the contractor wrote (or nothing) —
    // the placeholder is for Jamie's eyes, not the client's.
    description: clean[i].description.trim() || null,
  }))
}

/**
 * "Propose again" at Gate 1. The contractor talked to Jamie about what was
 * wrong with the proposal on screen — but a chat turn cannot change staged
 * rows, and until now the Propose button was hidden while a proposal sat
 * in review, so the only way out was to approve everything and delete the
 * extras from the Work Areas tab afterwards (Scheu, 2026-09-02).
 *
 * The pending proposal is marked rejected (superseded — retained for the
 * audit trail, never deleted) and the run steps back to in_progress so
 * Pass 1 can run again over the conversation, which now carries the
 * correction.
 */
export async function supersedePendingWorkAreas(runId: string): Promise<number> {
  const { data, error } = await supabase
    .from('jamie_proposed_work_areas')
    .update({ status: 'rejected' })
    .eq('jamie_run_id', runId)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(`Couldn't clear the previous proposal: ${error.message}`)
  await setRunStatus(runId, 'in_progress')
  return data?.length ?? 0
}

/**
 * The contractor deleted a work area on the Work Areas tab. If Jamie
 * created it at Gate 1, the staged row still says "approved" and Pass 2 /
 * Gate 2 would keep pricing and showing a work area that no longer exists
 * (the FK only nulls inserted_work_area_id — it does not change status).
 * Retire the staged row and any of its unreviewed lines BEFORE the delete,
 * while the link is still there to find them by.
 *
 * Best-effort by design: the read side also ignores staged work areas with
 * no real row behind them, so a failure here cannot resurface the area.
 */
export async function retireStagedWorkArea(workAreaId: string): Promise<void> {
  const { data: staged, error } = await supabase
    .from('jamie_proposed_work_areas')
    .select('id')
    .eq('inserted_work_area_id', workAreaId)
  if (error) throw new Error(`Couldn't update Jamie's records: ${error.message}`)
  const ids = (staged ?? []).map((s) => s.id as string)
  if (ids.length === 0) return
  const { error: linesErr } = await supabase
    .from('jamie_proposed_lines')
    .update({ status: 'rejected' })
    .in('jamie_proposed_work_area_id', ids)
    .eq('status', 'pending')
  if (linesErr) throw new Error(`Couldn't update Jamie's records: ${linesErr.message}`)
  const { error: waErr } = await supabase
    .from('jamie_proposed_work_areas')
    .update({ status: 'rejected' })
    .in('id', ids)
  if (waErr) throw new Error(`Couldn't update Jamie's records: ${waErr.message}`)
}

/** Gate 2 review payload: one entry per staged line. */
export interface LineDecision {
  id: string
  approved: boolean
  /** Contractor's edits — Gate 2 is where catalog misses get priced. */
  quantity: number | null
  unitCost: number | null
  /** Per-line markup % the contractor set on the card; null = follow My
   *  Numbers. Ignored on labor/equipment (KYN: those rates carry no
   *  markup). Jamie never sets this — it is the contractor's number. */
  markupOverride?: number | null
  /** A billed price the contractor typed over the computed one; null =
   *  computed. Same QC-style override the estimate editor has. */
  priceOverride?: number | null
}

/** A line the contractor typed onto the Gate 2 card themselves. */
export interface AddedLine {
  category: JamieLineCategory
  label: string
  unit: string
  quantity: number
  unitCost: number
  markupOverride?: number | null
  priceOverride?: number | null
}

/**
 * Gate 2 inline add (Ian's spec §6: add / edit / delete line items). The
 * contractor typed a line Jamie missed under one of her work areas. It is
 * staged on that work area exactly like hers — audit trail intact, same
 * commit path, same catalog flywheel — and returned as an approved
 * decision carrying the contractor's own numbers.
 */
export async function stageContractorLines(
  added: Record<string, AddedLine[]>
): Promise<LineDecision[]> {
  const out: LineDecision[] = []
  for (const [pwaId, lines] of Object.entries(added)) {
    const clean = lines.filter((l) => l.label.trim() && l.quantity > 0 && l.unitCost > 0)
    if (clean.length === 0) continue
    // Contractor-added rows sort after Jamie's on the same work area
    // (hers are 0..n; the scope check's additions sit at 900+).
    const staged = await stageProposedLines(
      pwaId,
      clean.map((l) => ({
        category: l.category,
        label: l.label,
        unit: l.unit || 'EA',
        quantity: l.quantity,
        unit_cost: l.unitCost,
        reasoning: 'Added by the contractor at Gate 2.',
        needs_pricing: false,
      })),
      1000
    )
    staged.forEach((s, i) => {
      out.push({
        id: s.id,
        approved: true,
        quantity: clean[i].quantity,
        unitCost: clean[i].unitCost,
        markupOverride: clean[i].markupOverride ?? null,
        priceOverride: clean[i].priceOverride ?? null,
      })
    })
  }
  return out
}

/**
 * Commit Gate 2. Approved staged lines become real `work_area_lines` on the
 * work area their parent proposal created at Gate 1, then the run closes as
 * `committed`. Returns the number of lines written.
 */
export async function commitLineGate(
  runId: string,
  decisions: LineDecision[],
  /** Final WORK ORDER scope per STAGED work area id, as edited at Gate 2
   *  (JAMIE-FLOW 4b). Pass 2 rewrites it from the takeoff; this carries
   *  the contractor's edits of that text onto the real work area. */
  descriptions: Record<string, string> = {},
  /** Final CLIENT scope per STAGED work area id (JAMIE-FLOW 4a) — the only
   *  scope text that reaches the client. Empty leaves Jamie's version. */
  clientScopes: Record<string, string> = {}
): Promise<{ written: number; catalogAdded: number }> {
  const byId = new Map(decisions.map((d) => [d.id, d]))
  const approvedIds = decisions.filter((d) => d.approved).map((d) => d.id)
  const rejectedIds = decisions.filter((d) => !d.approved).map((d) => d.id)

  // ── The catalog flywheel (KYN Layer 3: active learning) ─────────────
  // The contractor should never have to sit down and type a catalog. It
  // accretes from jobs they have already priced: every item Jamie writes
  // that isn't in the catalog yet becomes a catalog item at the moment
  // the contractor approves its price here. Next estimate, she prices it
  // from THEIR number instead of her own.
  //
  // Materials, subs and other only — labor and equipment rates belong to
  // My Numbers (company_labor_types / company_equipment_rates), and the
  // "General Conditions & Rounding" plug is per-job, not a catalog item.
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id ?? null
  const CATALOGABLE = new Set(['material', 'subcontractor', 'other'])
  const { data: existingCatalog } = userId
    ? await supabase.from('catalog_items').select('id, name').eq('user_id', userId)
    : { data: null }
  const catalogByName = new Map(
    ((existingCatalog ?? []) as Array<{ id: string; name: string }>).map((c) => [
      c.name.trim().toLowerCase(),
      c.id,
    ])
  )
  let catalogAdded = 0

  // Reload the staged rows so the commit uses server state, not whatever the
  // panel was holding — category and label are not contractor-editable here.
  const NO_MATCH = '00000000-0000-0000-0000-000000000000'
  const { data: staged, error: loadErr } = await supabase
    .from('jamie_proposed_lines')
    .select(
      'id, jamie_proposed_work_area_id, category, label, unit, quantity, unit_cost, catalog_item_id, kit_id, sort_order, jamie_proposed_work_areas!inner(inserted_work_area_id)'
    )
    .in('id', approvedIds.length > 0 ? approvedIds : [NO_MATCH])
  if (loadErr) throw new Error(`Couldn't load the staged lines: ${loadErr.message}`)

  let written = 0
  // Lines whose work area was never approved — or was deleted on the Work
  // Areas tab after Gate 1 — have nowhere to land. They are marked rejected
  // below rather than left pending forever, so the staging trail says what
  // actually happened to them.
  const orphanedIds: string[] = []
  for (const row of (staged ?? []) as unknown as Array<Record<string, unknown>>) {
    const parent = row.jamie_proposed_work_areas as {
      inserted_work_area_id: string | null
    } | null
    const waId = parent?.inserted_work_area_id
    if (!waId) {
      orphanedIds.push(row.id as string)
      continue
    }
    const d = byId.get(row.id as string)
    const label = String(row.label ?? '').trim()
    const category = row.category as string
    const cost = d?.unitCost ?? (row.unit_cost as number) ?? 0

    // Find-or-create the catalog item this line represents, so the
    // contractor's catalog grows from the work they actually price.
    let catalogItemId = (row.catalog_item_id as string) ?? null
    if (
      !catalogItemId &&
      userId &&
      CATALOGABLE.has(category) &&
      label &&
      !/general conditions/i.test(label) &&
      cost > 0
    ) {
      const key = label.toLowerCase()
      const hit = catalogByName.get(key)
      if (hit) {
        catalogItemId = hit
      } else {
        const { data: newItem } = await supabase
          .from('catalog_items')
          .insert({
            user_id: userId,
            name: label,
            unit: (row.unit as string) || 'EA',
            category,
            // The price the contractor just confirmed at Gate 2 — a real
            // number from a real job, not a guess.
            unit_cost: cost,
            // Markup stays 0 on the item: BidClaw applies the company
            // markup for the category at render (KYN — one universal
            // markup, not a per-item one).
            markup_percent: 0,
            needs_pricing: false,
            active: true,
          })
          .select('id')
          .single()
        if (newItem) {
          catalogItemId = newItem.id as string
          catalogByName.set(key, catalogItemId)
          catalogAdded++
        }
        // A failed catalog insert is deliberately NOT fatal — losing the
        // estimate because a catalog row wouldn't save is the wrong trade.
      }
    }

    // The contractor's own overrides from the card. Markup only where the
    // category bears one (KYN: labor and equipment rates already carry
    // margin); a price override wins over everything, as in the editor.
    const bearsMarkup = category === 'material' || category === 'subcontractor' || category === 'other'
    const markupOverride =
      bearsMarkup && d?.markupOverride !== null && d?.markupOverride !== undefined
        ? d.markupOverride
        : null
    const priceOverride =
      d?.priceOverride !== null && d?.priceOverride !== undefined ? d.priceOverride : null
    const { data: lineRow, error: lineErr } = await supabase
      .from('work_area_lines')
      .insert({
        work_area_id: waId,
        category,
        label,
        unit: (row.unit as string) ?? '',
        quantity: d?.quantity ?? (row.quantity as number) ?? 0,
        unit_cost: cost,
        price_override: priceOverride,
        markup_override: markupOverride,
        catalog_item_id: catalogItemId,
        source_kit_id: (row.kit_id as string) ?? null,
        sort_order: (row.sort_order as number) ?? 0,
      })
      .select('id')
      .single()
    if (lineErr || !lineRow) {
      throw new Error(`Couldn't add "${row.label}": ${lineErr?.message ?? 'no row'}`)
    }
    written++
    const { error: stampErr } = await supabase
      .from('jamie_proposed_lines')
      .update({ status: 'approved', inserted_work_area_line_id: lineRow.id as string })
      .eq('id', row.id as string)
    if (stampErr) throw new Error(`Couldn't record the approval: ${stampErr.message}`)
  }

  const toReject = [...rejectedIds, ...orphanedIds]
  if (toReject.length > 0) {
    const { error: rejErr } = await supabase
      .from('jamie_proposed_lines')
      .update({ status: 'rejected' })
      .in('id', toReject)
    if (rejErr) throw new Error(`Couldn't record the rejections: ${rejErr.message}`)
  }

  // The scope description is written LAST, from the line items, so it
  // lands on the real work area only now — after the takeoff it describes
  // actually exists. Scope and line items match by construction.
  const { data: approvedWas } = await supabase
    .from('jamie_proposed_work_areas')
    .select('id, inserted_work_area_id, proposed_description, proposed_client_description')
    .eq('jamie_run_id', runId)
    .eq('status', 'approved')
  for (const wa of (approvedWas ?? []) as Array<Record<string, unknown>>) {
    const waId = wa.inserted_work_area_id as string | null
    if (!waId) continue
    // Two scopes land here (JAMIE-FLOW §4a/4b): the work order the crew
    // builds from, and the proposal verbiage the client reads. Gate 2 can
    // edit either; `descriptions` carries the work order, `clientScopes`
    // the client text.
    const patch: Record<string, string> = {}
    const text = (descriptions[wa.id as string] ?? (wa.proposed_description as string) ?? '').trim()
    if (text) patch.description = text
    const clientText = (
      clientScopes[wa.id as string] ??
      (wa.proposed_client_description as string) ??
      ''
    ).trim()
    if (clientText) patch.client_description = clientText
    if (Object.keys(patch).length === 0) continue
    await supabase.from('work_areas').update(patch).eq('id', waId)
  }

  await setRunStatus(runId, 'committed')
  return { written, catalogAdded }
}

// ──────────────────────────────────────────────────────────────────────
// Gate reads
// ──────────────────────────────────────────────────────────────────────

/** Staged work areas for a run, in Jamie's proposed order. */
export async function listProposedWorkAreas(
  runId: string
): Promise<JamieProposedWorkArea[]> {
  const { data, error } = await supabase
    .from('jamie_proposed_work_areas')
    .select('*')
    .eq('jamie_run_id', runId)
    .order('sort_order')
  if (error) throw new Error(`Couldn't load the proposed work areas: ${error.message}`)
  return (data ?? []) as JamieProposedWorkArea[]
}

/**
 * Staged lines for a run, grouped under their staged work area. Only the
 * work areas that survived Gate 1 AND still exist carry lines, so this
 * drives the Gate 2 UI directly. A work area the contractor deleted after
 * Gate 1 has inserted_work_area_id nulled by the FK — its lines have
 * nowhere to land and must not be offered for approval.
 */
export async function listProposedLines(
  runId: string
): Promise<Array<JamieProposedWorkArea & { lines: JamieProposedLine[] }>> {
  const was = await listProposedWorkAreas(runId)
  const approved = was.filter(
    (w) => w.status === 'approved' && w.inserted_work_area_id !== null
  )
  if (approved.length === 0) return []
  const { data, error } = await supabase
    .from('jamie_proposed_lines')
    .select('*')
    .in(
      'jamie_proposed_work_area_id',
      approved.map((w) => w.id)
    )
    .order('sort_order')
  if (error) throw new Error(`Couldn't load the proposed lines: ${error.message}`)
  const lines = (data ?? []) as JamieProposedLine[]
  return approved.map((w) => ({
    ...w,
    lines: lines.filter((l) => l.jamie_proposed_work_area_id === w.id),
  }))
}
