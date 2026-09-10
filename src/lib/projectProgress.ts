import type {ProjectStatus,ProposalStatus} from './types'
export type ProposalProgress={status:ProposalStatus;created_at:string}
export function projectMilestone(status:ProjectStatus,proposals:ProposalProgress[]) {
  const project=(stage:ProjectStatus)=>({kind:'project' as const,status:stage,label:null})
  // Derive a consistent project milestone without changing saved records.
  if(['in_progress','complete','lost','archived'].includes(status)) return project(status)
  const latest=[...proposals].sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]
  if(!latest) return project(status)
  if(status==='approved' && ['draft','ready_to_send','sent','lost'].includes(latest.status)) return project(status)
  if(latest.status==='completed') return project('complete')
  if(latest.status==='in_progress') return project('in_progress')
  if(latest.status==='approved') return project('approved')
  if(latest.status==='lost') return project('lost')
  // A draft revision must not erase a proposal already made to the customer.
  if(status==='proposed' || latest.status==='sent' || proposals.some(p=>p.status==='sent')) return project('proposed')
  if(latest.status==='ready_to_send') return {kind:'proposal' as const,status:latest.status,label:'Ready to send'}
  return project(status==='estimating' ? 'estimating' : 'draft')
}
