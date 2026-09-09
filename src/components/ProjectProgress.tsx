import { StatusBadge } from '@/components/StatusBadge'
import type { ProjectStatus, ProposalStatus } from '@/lib/types'

export type ProposalProgress = { status: ProposalStatus; created_at: string }

/** Separate project stage from the latest proposal; never rewrite saved status. */
export function ProjectProgress({ status, proposals = [] }: { status: ProjectStatus; proposals?: ProposalProgress[] }) {
  const latest = [...proposals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return <div className="flex shrink-0 flex-col gap-1.5 text-xs">
    <div className="flex items-center gap-2"><span>Project:</span><StatusBadge kind="project" value={status} /></div>
    {latest && <div className="flex items-center gap-2"><span>Latest proposal:</span><StatusBadge kind="proposal" value={latest.status} /></div>}
  </div>
}
