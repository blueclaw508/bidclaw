import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Copy, FileText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import {
  createProposal,
  deleteProposal,
  duplicateProposal,
  listProposalsByProject,
} from '@/lib/proposals'
import { formatUSD } from '@/lib/money'
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

  // Delete-proposal modal state. proposalToDelete holds the row being
  // confirmed; null when the modal is closed. Hoisted to the tab level
  // so the modal renders outside any <Link> wrapper (avoids nested
  // interactive elements + simplifies focus management).
  const [proposalToDelete, setProposalToDelete] = useState<ProposalListRow | null>(null)

  // Per-row duplicating state — set to the id of the row whose Copy
  // button is currently in flight. Allows disabling that specific
  // button (not all rows) while the data-layer call runs. Phase 3d.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

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

  const handleConfirmDelete = useCallback(async () => {
    if (!proposalToDelete) return
    try {
      await deleteProposal(proposalToDelete.id)
      toast.success('Proposal deleted.')
      setProposalToDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete proposal.')
    }
  }, [proposalToDelete, load])

  /**
   * Duplicate a proposal then navigate directly into the new editor.
   * Per-row in-flight guard via duplicatingId so the button on this
   * specific row is disabled while the data-layer call runs.
   */
  const handleDuplicate = useCallback(
    async (row: ProposalListRow) => {
      if (duplicatingId) return
      setDuplicatingId(row.id)
      try {
        const { newProposalId } = await duplicateProposal(row.id)
        toast.success('Proposal duplicated.')
        navigate(`/app/projects/${project.id}/proposals/${newProposalId}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not duplicate proposal.')
        setDuplicatingId(null)
      }
      // No reset on success — we navigate away. If navigation is blocked
      // the button stays disabled; refresh fixes it.
    },
    [duplicatingId, navigate, project.id]
  )

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
          onRequestDelete={setProposalToDelete}
          onRequestDuplicate={handleDuplicate}
          duplicatingId={duplicatingId}
        />
      )}

      {/* Delete confirm — dynamic copy with cascade preview */}
      <ConfirmDialog
        open={!!proposalToDelete}
        onClose={() => setProposalToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete proposal?"
        description={
          proposalToDelete ? (
            <>
              Delete <span className="font-semibold">"{proposalToDelete.name}"</span>?
              This permanently removes the proposal and all{' '}
              <span className="font-semibold">
                {proposalToDelete.work_area_count} work area
                {proposalToDelete.work_area_count === 1 ? '' : 's'}
              </span>{' '}
              +{' '}
              <span className="font-semibold">
                {proposalToDelete.line_count} line item
                {proposalToDelete.line_count === 1 ? '' : 's'}
              </span>
              . This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        tone="danger"
      />
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
  onRequestDelete,
  onRequestDuplicate,
  duplicatingId,
}: {
  projectId: string
  projectName: string
  rows: ProposalListRow[]
  onRequestDelete: (row: ProposalListRow) => void
  onRequestDuplicate: (row: ProposalListRow) => void
  duplicatingId: string | null
}) {
  // Click handler for the trash button on each row. Lives inside a
  // <Link> so we must preventDefault AND stopPropagation to keep
  // React Router from navigating into the proposal editor.
  const handleTrashClick = (e: React.MouseEvent, row: ProposalListRow) => {
    e.preventDefault()
    e.stopPropagation()
    onRequestDelete(row)
  }

  // Same Link-blocking pattern for the copy button.
  const handleCopyClick = (e: React.MouseEvent, row: ProposalListRow) => {
    e.preventDefault()
    e.stopPropagation()
    if (duplicatingId) return // a duplication is already in flight
    void onRequestDuplicate(row)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Desktop header row — extra 36px cols for copy + trash buttons */}
      <div className="hidden grid-cols-[1.5fr_110px_140px_36px_36px_32px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div>Proposal</div>
        <div>Status</div>
        <div className="text-right">Grand total</div>
        <div />
        <div />
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
              <div className="hidden grid-cols-[1.5fr_110px_140px_36px_36px_32px] items-center gap-4 px-6 py-4 lg:grid">
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
                  <button
                    type="button"
                    onClick={(e) => handleCopyClick(e, p)}
                    disabled={duplicatingId !== null}
                    aria-label={`Duplicate ${p.name}`}
                    title={
                      duplicatingId === p.id
                        ? 'Duplicating…'
                        : 'Duplicate proposal'
                    }
                    className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={(e) => handleTrashClick(e, p)}
                    aria-label={`Delete ${p.name}`}
                    title="Delete proposal"
                    className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={(e) => handleCopyClick(e, p)}
                    disabled={duplicatingId !== null}
                    aria-label={`Duplicate ${p.name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                    {duplicatingId === p.id ? 'Duplicating…' : 'Duplicate'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleTrashClick(e, p)}
                    aria-label={`Delete ${p.name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-200"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
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
