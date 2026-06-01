import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/StatusBadge'
import { createProposal, listProposalsByProject } from '@/lib/proposals'
import type { Project, ProposalListRow } from '@/lib/types'

/**
 * Proposals tab on ProjectDetail. Lists every proposal owned by the
 * project, ordered by updated_at DESC (most recently touched first).
 *
 * Per scope decisions (revised Prompt 6):
 *   • "+ New proposal" is the only creation surface — proposals are
 *     now project-level, not derived from work areas.
 *   • One-click create: auto-name "{project} — Draft" for the first
 *     proposal, "{project} — Proposal N" for subsequent. Contractor
 *     can rename inline on the editor's gradient header (Phase 2d).
 *   • Per-row metadata: project_name · N areas · M lines · Updated
 *     {relative} — no dedicated work area column (scope decision Q4).
 *   • Grand total comes pre-aggregated from listProposalsByProject —
 *     single round-trip via PostgREST embedded resources.
 */

interface ProposalsTabProps {
  project: Project
}

export default function ProposalsTab({ project }: ProposalsTabProps) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProposalListRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setRows(await listProposalsByProject(project.id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load proposals.')
      setRows([])
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * One-click proposal creation. Picks the auto-name based on how
   * many proposals already exist on this project, calls createProposal,
   * navigates to the editor on success.
   *
   * Disabled while the request is in flight to prevent double-create
   * via rapid clicks.
   */
  const handleCreateProposal = useCallback(async () => {
    if (creating) return
    const existingCount = rows?.length ?? 0
    const name =
      existingCount === 0
        ? `${project.name} — Draft`
        : `${project.name} — Proposal ${existingCount + 1}`
    setCreating(true)
    try {
      const proposal = await createProposal({ projectId: project.id, name })
      toast.success('Proposal created.')
      navigate(`/app/projects/${project.id}/proposals/${proposal.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create proposal.')
      setCreating(false)
    }
    // Note: don't reset `creating` on success — we navigate away. If
    // navigation is somehow blocked the modal stays disabled, which
    // is fine — refresh fixes it.
  }, [creating, rows, project.id, project.name, navigate])

  const hasNone = rows !== null && rows.length === 0

  return (
    <div className="space-y-4">
      {/* Slate pastel section header — matches Work Areas + Files tabs. */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <FileText className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Proposals
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                The client-facing deliverable. Each proposal spans one or
                more work areas (project-linked or ad-hoc) and freezes its
                pricing at creation.
              </p>
            </div>
          </div>
          {/* Non-empty state surfaces the "+ New proposal" CTA at the top
              of the list card header. Empty state's CTA renders inside
              the empty card below. */}
          {!hasNone && rows && rows.length > 0 && (
            <button
              type="button"
              onClick={() => void handleCreateProposal()}
              disabled={creating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Creating…' : 'New proposal'}
            </button>
          )}
        </div>
      </section>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load proposals: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading proposals…
        </div>
      )}

      {!loadError && hasNone && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">
            No proposals yet
          </h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Create one to start estimating work for this project. You'll
            add work areas inside the editor.
          </p>
          <button
            type="button"
            onClick={() => void handleCreateProposal()}
            disabled={creating}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-gold-dark disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Creating…' : 'New proposal'}
          </button>
        </div>
      )}

      {!loadError && rows && rows.length > 0 && (
        <ProposalList
          projectId={project.id}
          projectName={project.name}
          rows={rows}
        />
      )}
    </div>
  )
}

/* ============================================================
 * ProposalList — slate-50 list card matching Prompt 4.5 pattern
 * ============================================================ */

function ProposalList({
  projectId,
  projectName,
  rows,
}: {
  projectId: string
  projectName: string
  rows: ProposalListRow[]
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Desktop header row */}
      <div className="hidden grid-cols-[1.5fr_110px_140px_32px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div>Proposal</div>
        <div>Status</div>
        <div className="text-right">Grand total</div>
        <div />
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              to={`/app/projects/${projectId}/proposals/${p.id}`}
              className="block transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              {/* Desktop layout */}
              <div className="hidden grid-cols-[1.5fr_110px_140px_32px] items-center gap-4 px-6 py-4 lg:grid">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    <span className="truncate">{projectName}</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>
                      {p.work_area_count} area{p.work_area_count === 1 ? '' : 's'}
                    </span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>
                      {p.line_count} line{p.line_count === 1 ? '' : 's'}
                    </span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>Updated {formatRelative(p.updated_at)}</span>
                  </div>
                </div>
                <div>
                  <StatusBadge kind="proposal" value={p.status} />
                </div>
                <div className="text-right text-sm font-semibold text-gray-900">
                  {formatUSD(p.grand_total)}
                </div>
                <div className="flex justify-end">
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </div>

              {/* Mobile layout — stacked card */}
              <div className="flex flex-col gap-2 px-4 py-4 lg:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">
                      {p.name}
                    </div>
                  </div>
                  <StatusBadge kind="proposal" value={p.status} className="shrink-0" />
                </div>
                <div className="text-xs text-gray-500">
                  <div className="truncate">{projectName}</div>
                  <div>
                    {p.work_area_count} area{p.work_area_count === 1 ? '' : 's'}
                    {' · '}
                    {p.line_count} line{p.line_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-900">
                    {formatUSD(p.grand_total)}
                  </span>
                  <span className="text-gray-500">
                    Updated {formatRelative(p.updated_at)}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * Format a timestamp as relative-to-now: "just now", "5 min ago",
 * "2 hours ago", "yesterday", "3 days ago", or a short date for older.
 * Cheap inline helper — avoids pulling in a date library.
 */
function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay} days ago`
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
