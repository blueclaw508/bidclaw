import type {ProjectStatus,ProposalStatus} from './types'
export type ProposalProgress={status:ProposalStatus;created_at:string}
export function projectMilestone(status:ProjectStatus,proposals:ProposalProgress[]) {
  // Operational/closed stages remain authoritative. Display derivation only.
  if(['in_progress','complete','lost','archived'].includes(status)) return {kind:'project' as const,status,label:null}
  const latest=[...proposals].sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]
  if(!latest) return {kind:'project' as const,status,label:null}
  if(status==='approved' && ['draft','ready_to_send','sent','lost'].includes(latest.status)) return {kind:'project' as const,status,label:null}
  const labels:Record<ProposalStatus,string>={draft:'Proposal draft',ready_to_send:'Ready to send',sent:'Proposal sent',approved:'Proposal approved',in_progress:'In progress',completed:'Complete',lost:'Proposal declined'}
  const label=latest.status==='draft' && proposals.some(p=>p.status==='sent') ? 'Revising proposal' : labels[latest.status]
  return {kind:'proposal' as const,status:latest.status,label}
}
