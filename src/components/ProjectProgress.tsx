import { StatusBadge } from '@/components/StatusBadge'
import type { ProjectStatus } from '@/lib/types'
import {projectMilestone,type ProposalProgress} from '@/lib/projectProgress'
import {PROPOSAL_STATUS_CONFIG} from '@/lib/statusConfig'

export type {ProposalProgress} from '@/lib/projectProgress'

/** Separate project stage from the latest proposal; never rewrite saved status. */
export function ProjectProgress({ status, proposals = [] }: { status: ProjectStatus; proposals?: ProposalProgress[] }) {
  const milestone=projectMilestone(status,proposals)
  if(milestone.kind==='project') return <StatusBadge kind="project" value={milestone.status}/>
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-sm font-medium ring-1 ring-inset ${PROPOSAL_STATUS_CONFIG[milestone.status].className}`}>{milestone.label}</span>
}
