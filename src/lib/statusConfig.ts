import type {
  CatalogCategory,
  LeadStage,
  ProjectStatus,
  ProposalLineCategory,
  ProposalStatus,
  WorkAreaStatus,
} from './types'

interface BadgeStyle {
  label: string
  // Tailwind classes — kept as a single string so consumers can apply directly.
  className: string
}

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'draft',
  'estimating',
  'proposed',
  'approved',
  'in_progress',
  'complete',
  'lost',
  'archived',
]

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, BadgeStyle> = {
  draft:       { label: 'Draft',       className: 'bg-slate-100   text-slate-700   ring-slate-200' },
  estimating:  { label: 'Estimating',  className: 'bg-sky-100     text-sky-800     ring-sky-200' },
  proposed:    { label: 'Proposed',    className: 'bg-amber-100   text-amber-800   ring-amber-200' },
  approved:    { label: 'Approved',    className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  in_progress: { label: 'In Progress', className: 'bg-indigo-100  text-indigo-800  ring-indigo-200' },
  complete:    { label: 'Complete',    className: 'bg-emerald-200 text-emerald-900 ring-emerald-300' },
  lost:        { label: 'Lost',        className: 'bg-rose-100    text-rose-800    ring-rose-200' },
  archived:    { label: 'Archived',    className: 'bg-zinc-100    text-zinc-500    ring-zinc-200' },
}

export const WORK_AREA_STATUS_ORDER: WorkAreaStatus[] = [
  'draft',
  'approved',
  'in_progress',
  'complete',
]

export const WORK_AREA_STATUS_CONFIG: Record<WorkAreaStatus, BadgeStyle> = {
  draft:       { label: 'Draft',       className: 'bg-slate-100   text-slate-700   ring-slate-200' },
  approved:    { label: 'Approved',    className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  in_progress: { label: 'In Progress', className: 'bg-indigo-100  text-indigo-800  ring-indigo-200' },
  complete:    { label: 'Complete',    className: 'bg-emerald-200 text-emerald-900 ring-emerald-300' },
}

export const PROPOSAL_STATUS_ORDER: ProposalStatus[] = [
  'draft',
  'presented',
  'accepted',
  'declined',
  'completed',
]

export const PROPOSAL_STATUS_CONFIG: Record<ProposalStatus, BadgeStyle> = {
  draft:     { label: 'Draft',     className: 'bg-slate-100   text-slate-700   ring-slate-200' },
  presented: { label: 'Presented', className: 'bg-amber-100   text-amber-800   ring-amber-200' },
  accepted:  { label: 'Accepted',  className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  declined:  { label: 'Declined',  className: 'bg-rose-100    text-rose-800    ring-rose-200' },
  completed: { label: 'Completed', className: 'bg-emerald-200 text-emerald-900 ring-emerald-300' },
}

// Pipeline order is Ian's exact sequence (LOOP.md P1-B). Labels are
// Ian's words verbatim — do not rename. 'lost' sits last; it's
// reachable from any stage, not a sequence step.
export const LEAD_STAGE_ORDER: LeadStage[] = [
  'lead',
  'pending',
  'estimating',
  'proposed',
  'signed',
  'in_progress',
  'completed',
  'lost',
]

export const LEAD_STAGE_CONFIG: Record<LeadStage, BadgeStyle> = {
  lead:        { label: 'Leads',       className: 'bg-slate-100   text-slate-700   ring-slate-200' },
  pending:     { label: 'Pending',     className: 'bg-purple-100  text-purple-800  ring-purple-200' },
  estimating:  { label: 'Estimating',  className: 'bg-sky-100     text-sky-800     ring-sky-200' },
  proposed:    { label: 'Proposed',    className: 'bg-amber-100   text-amber-800   ring-amber-200' },
  signed:      { label: 'Signed',      className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  in_progress: { label: 'In-Progress', className: 'bg-indigo-100  text-indigo-800  ring-indigo-200' },
  completed:   { label: 'Completed',   className: 'bg-emerald-200 text-emerald-900 ring-emerald-300' },
  lost:        { label: 'Lost',        className: 'bg-rose-100    text-rose-800    ring-rose-200' },
}

// Proposal line categories — display order + labels, consolidated from
// per-file copies in ProposalEditor / ProposalPrintView /
// ProposalWorkAreaSection (P1-D cleanup 2). All three agreed verbatim.
export const PROPOSAL_LINE_CATEGORY_ORDER: ProposalLineCategory[] = [
  'labor',
  'material',
  'equipment',
  'subcontractor',
  'other',
]

export const PROPOSAL_LINE_CATEGORY_LABELS: Record<ProposalLineCategory, string> = {
  labor: 'Labor',
  material: 'Materials',
  equipment: 'Equipment',
  subcontractor: 'Subcontractor',
  other: 'Other',
}

export const CATALOG_CATEGORY_ORDER: CatalogCategory[] = [
  'labor',
  'material',
  'equipment',
  'disposal',
  'design',
  'other',
]

export const CATALOG_CATEGORY_CONFIG: Record<CatalogCategory, BadgeStyle> = {
  labor:     { label: 'Labor',     className: 'bg-indigo-100 text-indigo-800 ring-indigo-200' },
  material:  { label: 'Material',  className: 'bg-sky-100    text-sky-800    ring-sky-200' },
  equipment: { label: 'Equipment', className: 'bg-amber-100  text-amber-800  ring-amber-200' },
  disposal:  { label: 'Disposal',  className: 'bg-zinc-100   text-zinc-700   ring-zinc-200' },
  design:    { label: 'Design',    className: 'bg-purple-100 text-purple-800 ring-purple-200' },
  other:     { label: 'Other',     className: 'bg-slate-100  text-slate-700  ring-slate-200' },
}
