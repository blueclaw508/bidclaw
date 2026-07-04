import { cn } from '@/lib/utils'
import {
  LEAD_STAGE_CONFIG,
  ESTIMATE_STATUS_CONFIG,
  PROJECT_STATUS_CONFIG,
  PROPOSAL_STATUS_CONFIG,
  WORK_AREA_STATUS_CONFIG,
  CATALOG_CATEGORY_CONFIG,
} from '@/lib/statusConfig'
import type {
  EstimateStatus,
  CatalogCategory,
  LeadStage,
  ProjectStatus,
  ProposalStatus,
  WorkAreaStatus,
} from '@/lib/types'

type Kind =
  | { kind: 'project'; value: ProjectStatus }
  | { kind: 'work_area'; value: WorkAreaStatus }
  | { kind: 'proposal'; value: ProposalStatus }
  | { kind: 'category'; value: CatalogCategory }
  | { kind: 'lead'; value: LeadStage }
  | { kind: 'estimate'; value: EstimateStatus }

export function StatusBadge(props: Kind & { className?: string }) {
  const cfg =
    props.kind === 'project'
      ? PROJECT_STATUS_CONFIG[props.value]
      : props.kind === 'estimate'
        ? ESTIMATE_STATUS_CONFIG[props.value]
        : props.kind === 'work_area'
          ? WORK_AREA_STATUS_CONFIG[props.value]
        : props.kind === 'proposal'
          ? PROPOSAL_STATUS_CONFIG[props.value]
          : props.kind === 'lead'
            ? LEAD_STAGE_CONFIG[props.value]
            : CATALOG_CATEGORY_CONFIG[props.value]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        cfg.className,
        props.className
      )}
    >
      {cfg.label}
    </span>
  )
}
