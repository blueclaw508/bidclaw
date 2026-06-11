// Data layer for the leads + lead_notes tables (Phase 1 P1-B —
// Leads & Bids pipeline, LOOP.md). All lead UI reads/writes through
// these functions — no direct supabase calls in components.
//
// Conventions match proposals.ts / kits.ts:
//   • Throw on error (callers handle with toast / state)
//   • RLS scopes queries to the current user — no explicit user_id
//     filter on reads (inserts still carry user_id for the policy)
//
// Stage model (drift-gate decisions, Loop session 1):
//   • leads.stage is the single source for the board. Lifecycle events
//     AUTO-ADVANCE it (convert → estimating, proposal presented →
//     proposed, accepted → signed, completed → completed); manual moves
//     are allowed everywhere.
//   • Auto-advance only moves a lead FORWARD in pipeline rank, and
//     never out of 'lost'. Backward moves (e.g. a reopened proposal)
//     are Ian's call, made manually on the board.
//   • Proposal declined does NOT auto-set 'lost' — the UI confirms
//     first (LOOP.md P1-B: "confirm, don't force").

import { supabase } from '@/lib/supabase'
import type {
  Lead,
  LeadListRow,
  LeadNote,
  LeadStage,
  ProjectStatus,
  ProposalStatus,
} from '@/lib/types'

export type { Lead, LeadListRow, LeadNote, LeadStage }

// ──────────────────────────────────────────────────────────────────────
// Stage maps + rank guard
// ──────────────────────────────────────────────────────────────────────

/** Pipeline rank for the forward-only auto-advance guard. */
const STAGE_RANK: Record<LeadStage, number> = {
  lead: 0,
  pending: 1,
  estimating: 2,
  proposed: 3,
  signed: 4,
  in_progress: 5,
  completed: 6,
  lost: 7, // terminal; auto-advance never writes it (manual only)
}

/**
 * Proposal status → lead stage. 'declined' is intentionally absent:
 * declining prompts the contractor to confirm Lost, never forces it.
 * 'draft' absent: reverting a proposal doesn't demote the lead.
 */
const STAGE_FOR_PROPOSAL_STATUS: Partial<Record<ProposalStatus, LeadStage>> = {
  presented: 'proposed',
  accepted: 'signed',
  completed: 'completed',
}

/**
 * Project status → lead stage (manual project status dropdown on
 * ProjectDetail). 'draft' and 'archived' have no pipeline meaning.
 * 'lost' IS mapped here — explicitly marking the project lost is
 * already a deliberate act, unlike a proposal decline.
 */
const STAGE_FOR_PROJECT_STATUS: Partial<Record<ProjectStatus, LeadStage>> = {
  estimating: 'estimating',
  proposed: 'proposed',
  approved: 'signed',
  in_progress: 'in_progress',
  complete: 'completed',
  lost: 'lost',
}

// ──────────────────────────────────────────────────────────────────────
// Lead CRUD
// ──────────────────────────────────────────────────────────────────────

/**
 * Load every lead with its project summary + proposal aggregates in a
 * single round-trip. Filtering/sorting is client-side (single-user app,
 * modest row counts — same call as Projects.tsx; revisit at ~500 rows).
 */
export async function listLeads(): Promise<LeadListRow[]> {
  const { data, error } = await supabase
    .from('leads')
    .select(
      `*,
       projects (
         id, name, status,
         proposals ( id, status, presented_at )
       )`
    )
    .order('created_at', { ascending: false })
  if (error) {
    throw new Error(`Couldn't load leads: ${error.message}`)
  }
  type RawRow = Lead & {
    projects:
      | (Pick<LeadListRow, never> & {
          id: string
          name: string
          status: ProjectStatus
          proposals: Array<{ id: string; status: ProposalStatus; presented_at: string | null }>
        })
      | null
  }
  return ((data ?? []) as RawRow[]).map((row) => {
    const { projects, ...lead } = row
    const proposals = projects?.proposals ?? []
    let last_presented_at: string | null = null
    for (const p of proposals) {
      if (p.presented_at && (!last_presented_at || p.presented_at > last_presented_at)) {
        last_presented_at = p.presented_at
      }
    }
    return {
      ...lead,
      project: projects ? { id: projects.id, name: projects.name, status: projects.status } : null,
      proposal_count: proposals.length,
      last_presented_at,
    } satisfies LeadListRow
  })
}

/** Load one lead. Null when not found (or not yours — RLS). */
export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load lead: ${error.message}`)
  return (data as Lead) ?? null
}

export async function createLead(input: {
  userId: string
  name: string
  phone?: string | null
  email?: string | null
  job_address?: string | null
  town?: string | null
  source?: string | null
  follow_up_date?: string | null
}): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      user_id: input.userId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      job_address: input.job_address?.trim() || null,
      town: input.town?.trim() || null,
      source: input.source?.trim() || null,
      follow_up_date: input.follow_up_date || null,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't create lead: ${error?.message ?? 'no row returned'}`)
  }
  return data as Lead
}

export async function updateLead(
  id: string,
  patch: Partial<
    Pick<
      Lead,
      | 'name'
      | 'phone'
      | 'email'
      | 'job_address'
      | 'town'
      | 'source'
      | 'stage'
      | 'follow_up_date'
      | 'project_id'
    >
  >
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't update lead: ${error?.message ?? 'no row returned'}`)
  }
  return data as Lead
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw new Error(`Couldn't delete lead: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Notes (timestamped, append-only)
// ──────────────────────────────────────────────────────────────────────

export async function listLeadNotes(leadId: string): Promise<LeadNote[]> {
  const { data, error } = await supabase
    .from('lead_notes')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Couldn't load notes: ${error.message}`)
  return (data ?? []) as LeadNote[]
}

export async function addLeadNote(leadId: string, body: string): Promise<LeadNote> {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Note is empty.')
  const { data, error } = await supabase
    .from('lead_notes')
    .insert({ lead_id: leadId, body: trimmed })
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't add note: ${error?.message ?? 'no row returned'}`)
  }
  return data as LeadNote
}

// ──────────────────────────────────────────────────────────────────────
// Conversion — lead → project (→ Estimating)
// ──────────────────────────────────────────────────────────────────────

/**
 * Convert a lead into a project at 'estimating' (LOOP.md: "a lead
 * converts to a project (→ Estimating)").
 *
 * Customer handling: 'create' makes a customer from the lead's contact
 * fields; 'existing' links one the contractor picked; 'none' leaves the
 * project unassigned (assignable later on ProjectDetail).
 *
 * Atomicity: JS-side with defensive cleanup (duplicateProposal
 * pattern) — if the lead-link step fails after the project row exists,
 * the project is deleted so no orphan appears in the Projects list.
 */
export async function convertLeadToProject(input: {
  lead: Lead
  userId: string
  projectName: string
  customerMode: 'create' | 'existing' | 'none'
  existingCustomerId?: string
}): Promise<{ lead: Lead; projectId: string }> {
  const { lead, userId } = input
  if (lead.project_id) {
    throw new Error('This lead is already linked to a project.')
  }

  let customerId: string | null = null
  if (input.customerMode === 'existing') {
    if (!input.existingCustomerId) throw new Error('Pick a customer to link.')
    customerId = input.existingCustomerId
  } else if (input.customerMode === 'create') {
    const { data, error } = await supabase
      .from('customers')
      .insert({
        user_id: userId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        site_address: joinAddress(lead.job_address, lead.town),
      })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`Couldn't create customer from lead: ${error?.message ?? 'no row returned'}`)
    }
    customerId = data.id as string
  }

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      customer_id: customerId,
      name: input.projectName.trim(),
      status: 'estimating',
      site_address: joinAddress(lead.job_address, lead.town),
    })
    .select('id')
    .single()
  if (projectErr || !project) {
    throw new Error(`Couldn't create project: ${projectErr?.message ?? 'no row returned'}`)
  }
  const projectId = project.id as string

  try {
    const updated = await updateLead(lead.id, {
      project_id: projectId,
      stage: 'estimating',
    })
    return { lead: updated, projectId }
  } catch (e) {
    // Defensive cleanup — don't leave an orphan project the lead
    // doesn't know about.
    await supabase.from('projects').delete().eq('id', projectId)
    throw e
  }
}

function joinAddress(address: string | null, town: string | null): string | null {
  const parts = [address?.trim(), town?.trim()].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// ──────────────────────────────────────────────────────────────────────
// Lifecycle sync — derived stage advances (forward-only)
// ──────────────────────────────────────────────────────────────────────

/**
 * Advance the lead linked to `projectId` (if any) per the mapped stage.
 * Forward-only: never demotes, never moves a lead out of 'lost'.
 * Returns the new stage when a move happened, else null.
 *
 * Callers treat this as best-effort — a sync failure must never fail
 * the proposal/project write that triggered it.
 */
async function advanceLinkedLead(
  projectId: string,
  target: LeadStage | undefined
): Promise<LeadStage | null> {
  if (!target) return null
  const { data, error } = await supabase
    .from('leads')
    .select('id, stage')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error || !data) return null
  const current = data.stage as LeadStage
  if (current === 'lost') return null
  if (STAGE_RANK[target] <= STAGE_RANK[current]) return null
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ stage: target })
    .eq('id', data.id)
  if (updateErr) return null
  return target
}

/** Hook for proposals.ts — call after a successful status write. */
export async function syncLeadStageForProposalStatus(
  projectId: string,
  status: ProposalStatus
): Promise<LeadStage | null> {
  return advanceLinkedLead(projectId, STAGE_FOR_PROPOSAL_STATUS[status])
}

/** Hook for ProjectDetail — call after a successful status patch. */
export async function syncLeadStageForProjectStatus(
  projectId: string,
  status: ProjectStatus
): Promise<LeadStage | null> {
  return advanceLinkedLead(projectId, STAGE_FOR_PROJECT_STATUS[status])
}

/**
 * True when `projectId` has a linked lead that is not already lost —
 * used by the proposal editor to offer the "move lead to Lost?"
 * confirm after a decline (confirm, don't force).
 */
export async function getLinkedLeadForLostPrompt(
  projectId: string
): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error || !data) return null
  const lead = data as Lead
  return lead.stage === 'lost' ? null : lead
}
