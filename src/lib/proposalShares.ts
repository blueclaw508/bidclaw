import { supabase } from '@/lib/supabase'
import type {
  CompanySettings,
  Customer,
  Project,
  ProposalShare,
  ProposalSignature,
  ProposalWithWorkAreas,
} from '@/lib/types'
import { shapeProposal } from '@/lib/proposals'

/* ============================================================
 * Contractor side — owner-scoped, through RLS and two RPCs (0043)
 * ============================================================ */

/** The URL a client opens. Same origin as the app, no login. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/p/${token}`
}

/**
 * Create the client link, or regenerate it. A draft moves to Sent on the
 * way out, so the send gate's errors surface here exactly as they do from
 * the status menu — callers should route them through the same upgrade
 * path (isSendGateError / isTrialSendGateError).
 */
export async function createProposalShare(proposalId: string): Promise<ProposalShare> {
  const { data, error } = await supabase.rpc('create_proposal_share', {
    p_proposal_id: proposalId,
  })
  if (error) throw new Error(error.message)
  return data as ProposalShare
}

/** Close the link. The row stays, so the view count survives. */
export async function revokeProposalShare(proposalId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_proposal_share', {
    p_proposal_id: proposalId,
  })
  if (error) throw new Error(error.message)
}

/** The proposal's link, if one was ever created. Null before the first share. */
export async function getProposalShare(proposalId: string): Promise<ProposalShare | null> {
  const { data, error } = await supabase
    .from('proposal_shares')
    .select('*')
    .eq('proposal_id', proposalId)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load share link: ${error.message}`)
  return (data as ProposalShare | null) ?? null
}

/** The client's latest decision on this proposal. Null until they act. */
export async function getLatestSignature(proposalId: string): Promise<ProposalSignature | null> {
  const { data, error } = await supabase
    .from('proposal_signatures')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load signature: ${error.message}`)
  return (data as ProposalSignature | null) ?? null
}

/** True while a link exists, is not revoked, and has not expired. */
export function shareIsLive(share: ProposalShare | null): boolean {
  if (!share || share.revoked_at) return false
  return new Date(share.expires_at).getTime() > Date.now()
}

/* ============================================================
 * Client side — the public page, through the proposal-share function
 * ============================================================ */

/**
 * What the client page gets. `settings` carries only the branding and
 * terms columns; the function never sends the rest of the row, so this
 * is a Pick even though the document renders it as CompanySettings.
 */
export interface SharedProposalPayload {
  proposal: ProposalWithWorkAreas
  project: Project
  customer: Customer | null
  settings: CompanySettings
  logoUrl: string | null
  signature: ProposalSignature | null
  canSign: boolean
}

export type SharedProposalErrorCode =
  | 'link_not_found'
  | 'link_closed'
  | 'link_expired'
  | 'proposal_unavailable'
  | 'already_signed'
  | 'approve_refused'
  | 'bad_request'
  | 'server_error'

export class SharedProposalError extends Error {
  code: SharedProposalErrorCode
  constructor(code: SharedProposalErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

async function invokeShare<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('proposal-share', { body })
  if (error) {
    // The function's own sentence is the useful one; dig it out of the
    // response the client wrapped.
    let code: SharedProposalErrorCode = 'server_error'
    let message = 'Something went wrong. Try again.'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string; message?: string }
        if (payload?.error) code = payload.error as SharedProposalErrorCode
        if (payload?.message) message = payload.message
      } catch {
        /* keep the defaults */
      }
    }
    throw new SharedProposalError(code, message)
  }
  return data as T
}

export async function fetchSharedProposal(token: string): Promise<SharedProposalPayload> {
  const raw = await invokeShare<Omit<SharedProposalPayload, 'proposal'> & { proposal: unknown }>({
    action: 'view',
    token,
  })
  return { ...raw, proposal: shapeProposal(raw.proposal) }
}

export interface SignInput {
  decision: 'accepted' | 'declined'
  signer_name: string
  signer_email?: string
  signature_data?: string
  decline_reason?: string
  agree?: boolean
}

export async function signSharedProposal(
  token: string,
  input: SignInput
): Promise<ProposalSignature> {
  const res = await invokeShare<{ ok: true; signature: ProposalSignature }>({
    action: 'sign',
    token,
    ...input,
  })
  return res.signature
}
