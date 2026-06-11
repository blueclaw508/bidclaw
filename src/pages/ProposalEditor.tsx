import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  ClipboardList,
  Download,
  FileText,
  Info,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { BlurSaveInput } from '@/components/InlineEdit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { AddWorkAreaFromProjectModal } from '@/components/proposals/AddWorkAreaFromProjectModal'
import { AddAdHocWorkAreaModal } from '@/components/proposals/AddAdHocWorkAreaModal'
import ProposalWorkAreaSection from '@/components/proposals/ProposalWorkAreaSection'
import { supabase } from '@/lib/supabase'
import {
  availableTransitions,
  deleteProposal,
  getProposal,
  getProposalTotals,
  isProposalEditable,
  reorderProposalWorkAreas,
  saveProposalLines,
  syncProposalWorkAreaSubtotals,
  updateProposal,
  type ProposalLinePatch,
  type StatusTransition,
} from '@/lib/proposals'
import { lineHasErrors } from '@/components/proposals/ProposalLineRow'
import {
  StatusBanner,
  StatusMenu,
  transitionDescription,
} from '@/components/proposals/ProposalStatusControls'
import { TotalsBreakdown } from '@/components/proposals/TotalsBreakdown'
import { getLinkedLeadForLostPrompt, updateLead } from '@/lib/leads'
import { categoryBearsMarkup } from '@/lib/money'
import type {
  Lead,
  Project,
  ProposalLine,
  ProposalWithWorkAreas,
  ProposalWorkAreaResolved,
  WorkArea,
} from '@/lib/types'

/**
 * Phase 2d SCAFFOLD. QC-style multi-work-area editor with the chrome
 * in place: gradient header (inline-editable name + project subtitle
 * + status badge), toolbar (Save/Calculate/Download/Send), Indigo
 * Info card (notes save bar), Slate Work Areas card (minimal list +
 * "+ Add" CTAs), Slate Totals card.
 *
 * Phase 2e replaces the simple work area list with the full per-work-
 * area card (subsections / line items / drag-drop). Phase 2f makes
 * line items inline-editable. Phase 2g adds the line-item add flow
 * (AddFromKitModal + AddFromCatalogModal). Phase 2h handles polish +
 * zero-price warning + final totals UX.
 *
 * Save semantics in 2d:
 *   • Proposal name → save-on-blur (BlurSaveInput, matches KitDetail).
 *   • Notes → sticky Save+Reset bar (Settings + KitDetail body pattern).
 *   • Work area add/remove → immediate DB write, no save bar.
 */

type TotalsView = Awaited<ReturnType<typeof getProposalTotals>>

export default function ProposalEditor() {
  const { projectId, proposalId } = useParams<{
    projectId: string
    proposalId: string
  }>()
  const navigate = useNavigate()

  // Server snapshot — floor for diff/reset on notes
  const [proposal, setProposal] = useState<ProposalWithWorkAreas | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [projectWorkAreas, setProjectWorkAreas] = useState<WorkArea[]>([])
  const [totals, setTotals] = useState<TotalsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Notes draft state (Save+Reset bar pattern)
  const [notesDraft, setNotesDraft] = useState<string>('')

  // Delete-proposal modal state — null when closed, true when the
  // contractor has clicked the toolbar Delete button + we're waiting
  // on confirm. Hard-cleanup action; allowed at any status (delete is
  // not gated by isProposalEditable like UPDATE operations are).
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Phase 3c status lifecycle — dropdown open + pending transition.
  // pendingTransition holds the transition the contractor clicked; we
  // surface ConfirmDialog with the target status until they confirm.
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [pendingTransition, setPendingTransition] = useState<StatusTransition | null>(null)
  const [transitioning, setTransitioning] = useState(false)

  // P1-B: after a decline, if the project has a linked lead, offer
  // (never force) moving it to Lost. Holds the lead while the prompt
  // is open; null = closed.
  const [lostPromptLead, setLostPromptLead] = useState<Lead | null>(null)

  // Per-line draft state. `localLines` holds the live edited values
  // keyed by line id; `originalLines` is the server snapshot for diff
  // + reset. `deletedLineIds` tracks lines the user removed locally
  // (commit on Save). All three are populated on every reload.
  const [localLines, setLocalLines] = useState<Record<string, ProposalLine>>({})
  const [originalLines, setOriginalLines] = useState<Record<string, ProposalLine>>({})
  const [deletedLineIds, setDeletedLineIds] = useState<Set<string>>(new Set())

  // Unified save / saving state — drives both the toolbar Save button
  // and the sticky bottom bar.
  const [saving, setSaving] = useState(false)

  // Modal + dialog state
  const [addFromProjectOpen, setAddFromProjectOpen] = useState(false)
  const [addAdHocOpen, setAddAdHocOpen] = useState(false)

  // Calculate button feedback
  const [calculating, setCalculating] = useState(false)

  // dnd-kit sensors for work area card reorder
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /* ---------- load ---------- */

  const load = useCallback(async () => {
    if (!proposalId) return
    setLoading(true)
    try {
      const p = await getProposal(proposalId)
      if (!p) {
        setNotFound(true)
        return
      }
      setProposal(p)
      setNotesDraft(p.notes ?? '')
      primeLineState(p, setLocalLines, setOriginalLines)
      setDeletedLineIds(new Set())

      // Fetch the parent project (for the header subtitle) and the
      // project's work areas (for the "Add from project" modal). In
      // parallel — small payloads.
      //
      // NOTE: settings markup % is intentionally NOT fetched here. The
      // editor never surfaces current-settings markup; every line's
      // markup is the line's own frozen value (snapshotted at insert)
      // and the contract is that settings changes never retroactively
      // shift past proposals.
      const [
        { data: proj, error: pErr },
        { data: was, error: wErr },
      ] = await Promise.all([
        supabase
          .from('projects')
          .select('*')
          .eq('id', p.project_id)
          .maybeSingle(),
        supabase
          .from('work_areas')
          .select('*')
          .eq('project_id', p.project_id)
          .order('sequence_order', { ascending: true }),
      ])
      if (pErr) throw new Error(`Couldn't load project: ${pErr.message}`)
      if (!proj) throw new Error('Project not found.')
      setProject(proj as Project)
      if (wErr) throw new Error(`Couldn't load project work areas: ${wErr.message}`)
      setProjectWorkAreas((was ?? []) as WorkArea[])

      // Initial totals fetch
      setTotals(await getProposalTotals(proposalId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load proposal.')
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  useEffect(() => {
    void load()
  }, [load])

  /* ---------- header name save-on-blur ---------- */

  const handleSaveName = useCallback(
    async (next: string): Promise<boolean> => {
      if (!proposal) return false
      const trimmed = next.trim()
      if (!trimmed) {
        toast.error('Proposal name cannot be empty.')
        return false
      }
      try {
        const updated = await updateProposal(proposal.id, { name: trimmed })
        setProposal((prev) => (prev ? { ...prev, ...updated } : prev))
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Save failed.')
        return false
      }
    },
    [proposal]
  )

  /* ---------- dirty + validation derivation ---------- */
  // Notes dirty when the textarea differs from the saved proposal.notes.
  const notesDirty = useMemo(() => {
    if (!proposal) return false
    return notesDraft !== (proposal.notes ?? '')
  }, [notesDraft, proposal])

  // A line is dirty when any of (name / quantity / cost / sort_order)
  // differs from the server snapshot, or when it's in deletedLineIds.
  // We diff against `originalLines` so transient typing during a
  // single edit session (e.g. "1." while typing 1.5) is captured.
  const dirtyLineIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id in localLines) {
      const local = localLines[id]
      const orig = originalLines[id]
      if (!orig) continue
      if (
        local.label !== orig.label ||
        Number(local.quantity) !== Number(orig.quantity) ||
        Number(local.frozen_unit_cost) !== Number(orig.frozen_unit_cost) ||
        // NaN !== n is true, so a cleared markup field (NaN) correctly
        // marks the line dirty; markupInvalid then blocks Save.
        Number(local.frozen_markup_percent) !== Number(orig.frozen_markup_percent) ||
        Number(local.sort_order) !== Number(orig.sort_order)
      ) {
        ids.add(id)
      }
    }
    return ids
  }, [localLines, originalLines])

  // Any line in localLines (non-deleted) failing validation blocks save.
  const linesWithErrors = useMemo(() => {
    const ids = new Set<string>()
    for (const id in localLines) {
      if (deletedLineIds.has(id)) continue
      if (lineHasErrors(localLines[id])) ids.add(id)
    }
    return ids
  }, [localLines, deletedLineIds])

  const linesDirtyCount = dirtyLineIds.size + deletedLineIds.size
  const anyDirty = notesDirty || linesDirtyCount > 0
  const canSave = anyDirty && linesWithErrors.size === 0 && !saving

  // Items-need-pricing count: lines with frozen_unit_cost = 0 (or NaN
  // after a cleared input). Computed live from localLines so the banner
  // updates as the contractor enters/clears prices. Counts deleted lines
  // are excluded; disabled work areas ARE included (per spec: "across
  // ALL work areas of the proposal, enabled + disabled").
  const itemsNeedingPricingCount = useMemo(() => {
    let count = 0
    for (const id in localLines) {
      if (deletedLineIds.has(id)) continue
      const l = localLines[id]
      const cost = Number(l.frozen_unit_cost)
      if (!Number.isFinite(cost) || cost === 0) count++
    }
    return count
  }, [localLines, deletedLineIds])

  /* ---------- line draft callbacks ---------- */

  const handleLineChange = useCallback(
    (lineId: string, patch: Partial<ProposalLine>) => {
      setLocalLines((prev) => {
        const current = prev[lineId]
        if (!current) return prev
        return { ...prev, [lineId]: { ...current, ...patch } }
      })
    },
    []
  )

  const handleLineDelete = useCallback((lineId: string) => {
    setDeletedLineIds((prev) => {
      if (prev.has(lineId)) return prev
      const next = new Set(prev)
      next.add(lineId)
      return next
    })
  }, [])

  /**
   * Drag-drop reorder within a single (proposal_work_area, category).
   * Receives the new ordered list of line ids; updates sort_order on
   * each affected localLine. Cross-category drags are blocked by
   * having a per-subsection SortableContext (separate id spaces).
   */
  const handleLineReorder = useCallback((orderedIds: string[]) => {
    setLocalLines((prev) => {
      const next = { ...prev }
      orderedIds.forEach((id, idx) => {
        if (next[id]) {
          next[id] = { ...next[id], sort_order: idx }
        }
      })
      return next
    })
  }, [])

  /* ---------- unified Save + Reset ---------- */

  const handleSaveAll = useCallback(async () => {
    if (!proposal || !canSave) return
    setSaving(true)
    try {
      const ops: Promise<unknown>[] = []
      // Notes
      if (notesDirty) {
        ops.push(
          updateProposal(proposal.id, {
            notes: notesDraft.trim() ? notesDraft : null,
          })
        )
      }
      // Batched line save (P1-D cleanup 1): one editability check, all
      // line updates + deletes grouped, each affected work area's
      // subtotals synced exactly ONCE at the end — replaces the old
      // per-line calls whose parallel syncs raced on shared work areas.
      const updates = [...dirtyLineIds].map((id) => {
        const l = localLines[id]
        const patch: ProposalLinePatch = {
          label: l.label.trim(),
          quantity: Number(l.quantity),
          frozen_unit_cost: Number(l.frozen_unit_cost),
          sort_order: l.sort_order,
        }
        // Markup is patchable only on markup-bearing categories — the
        // data layer throws if a labor/equipment patch carries the
        // field at all (Phase 3a guard).
        if (categoryBearsMarkup(l.category)) {
          patch.frozen_markup_percent = Number(l.frozen_markup_percent)
        }
        return { id, patch }
      })
      if (updates.length > 0 || deletedLineIds.size > 0) {
        ops.push(
          saveProposalLines({
            proposalId: proposal.id,
            updates,
            deleteIds: [...deletedLineIds],
          })
        )
      }
      await Promise.all(ops)

      // Reload fresh server-truth payload + totals
      const [p, t] = await Promise.all([
        getProposal(proposal.id),
        getProposalTotals(proposal.id),
      ])
      if (p) {
        setProposal(p)
        primeLineState(p, setLocalLines, setOriginalLines)
        setNotesDraft(p.notes ?? '')
      }
      setTotals(t)
      setDeletedLineIds(new Set())
      toast.success('Saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }, [
    proposal,
    canSave,
    notesDirty,
    notesDraft,
    dirtyLineIds,
    localLines,
    deletedLineIds,
  ])

  const handleResetAll = useCallback(() => {
    if (!proposal) return
    setNotesDraft(proposal.notes ?? '')
    setLocalLines({ ...originalLines })
    setDeletedLineIds(new Set())
  }, [proposal, originalLines])

  /* ---------- status transition ---------- */

  const handleConfirmTransition = useCallback(async () => {
    if (!proposalId || !pendingTransition) return
    setTransitioning(true)
    try {
      await updateProposal(proposalId, { status: pendingTransition.target })
      // Refetch the proposal so the local state mirrors the new status
      // (editability flips immediately, banner updates, etc.)
      const fresh = await getProposal(proposalId)
      if (fresh) setProposal(fresh)
      toast.success(`Marked as ${pendingTransition.target}.`)
      setPendingTransition(null)
      // P1-B: declined → offer to move the linked lead to Lost
      // (confirm, don't force). Best-effort lookup; silence failures.
      if (pendingTransition.target === 'declined' && projectId) {
        try {
          const lead = await getLinkedLeadForLostPrompt(projectId)
          if (lead) setLostPromptLead(lead)
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status update failed.')
    } finally {
      setTransitioning(false)
    }
  }, [proposalId, pendingTransition, projectId])

  /* ---------- delete proposal ---------- */

  const handleConfirmDelete = useCallback(async () => {
    if (!proposalId || !projectId) return
    try {
      await deleteProposal(proposalId)
      toast.success('Proposal deleted.')
      // Navigate back to the project's proposals tab. The list reloads
      // on mount via ProposalsTab's useEffect → the deleted row is gone.
      navigate(`/app/projects/${projectId}?tab=proposals`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete proposal.')
      setDeleteOpen(false)
    }
  }, [proposalId, projectId, navigate])

  /* ---------- calculate button ---------- */

  const handleCalculate = useCallback(async () => {
    if (!proposalId || !proposal) return
    setCalculating(true)
    try {
      // Phase 2h refinement: force-sync every work area's denormalized
      // subtotals from current proposal_lines BEFORE refetching totals.
      // Catches any drift introduced by bypassed code paths and gives
      // the contractor an explicit "everything is in sync now" signal.
      await Promise.all(
        proposal.work_areas.map((wa) => syncProposalWorkAreaSubtotals(wa.id))
      )
      const fresh = await getProposalTotals(proposalId)
      setTotals(fresh)
      toast.success('Totals refreshed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Calculate failed.')
    } finally {
      setCalculating(false)
    }
  }, [proposalId, proposal])

  /* ---------- work area add/remove ---------- */

  const refreshAfterWorkAreaChange = useCallback(async () => {
    if (!proposalId) return
    try {
      const [p, t] = await Promise.all([
        getProposal(proposalId),
        getProposalTotals(proposalId),
      ])
      if (p) {
        setProposal(p)
        // Re-prime the line draft state too — new work area may carry
        // lines (Phase 2g) and lines on removed work areas need to fall
        // out of local maps cleanly.
        primeLineState(p, setLocalLines, setOriginalLines)
        setDeletedLineIds(new Set())
        setNotesDraft(p.notes ?? '')
      }
      setTotals(t)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed.')
    }
  }, [proposalId])

  /* ---------- liveWorkAreas projection ---------- */
  // Merge local-draft line values into the proposal's work areas so
  // each ProposalWorkAreaSection renders the editor's current state,
  // not the stale server snapshot. Deleted lines are filtered out and
  // lines are re-sorted by their (possibly drafted) sort_order.
  const liveWorkAreas = useMemo<ProposalWorkAreaResolved[]>(() => {
    if (!proposal) return []
    return proposal.work_areas.map((wa) => ({
      ...wa,
      lines: wa.lines
        .filter((l) => !deletedLineIds.has(l.id))
        .map((l) => localLines[l.id] ?? l)
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
  }, [proposal, localLines, deletedLineIds])

  /* ---------- dnd-kit reorder ---------- */
  // Optimistic local reorder, persist via reorderProposalWorkAreas.
  // On failure, refresh from the server to restore the canonical order.
  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id || !proposal) return
      const oldIdx = proposal.work_areas.findIndex((w) => w.id === active.id)
      const newIdx = proposal.work_areas.findIndex((w) => w.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const reordered = arrayMove(proposal.work_areas, oldIdx, newIdx)
      setProposal({ ...proposal, work_areas: reordered })
      try {
        await reorderProposalWorkAreas(
          proposal.id,
          reordered.map((w) => w.id)
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Reorder failed.')
        await refreshAfterWorkAreaChange()
      }
    },
    [proposal, refreshAfterWorkAreaChange]
  )

  const alreadyAttachedWorkAreaIds = useMemo(() => {
    const set = new Set<string>()
    proposal?.work_areas.forEach((wa) => {
      if (wa.work_area_id) set.add(wa.work_area_id)
    })
    return set
  }, [proposal])

  const totalLineCount = useMemo(() => {
    if (!proposal) return 0
    return proposal.work_areas.reduce((sum, wa) => sum + wa.lines.length, 0)
  }, [proposal])

  /* ---------- render ---------- */

  if (loading && !proposal) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        Loading proposal…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-bold text-rose-900">Proposal not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This proposal doesn't exist, or belongs to a different account.
        </p>
        <Link
          to={projectId ? `/app/projects/${projectId}?tab=proposals` : '/app/projects'}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
      </div>
    )
  }

  if (!proposal || !project) return null

  // Phase 3c: editability flips when status leaves 'draft'. Every editable
  // surface honors this; the status banner upstream tells the contractor
  // why. Re-derived per render — state-driven by proposal.status.
  const readOnly = !isProposalEditable(proposal.status)
  const transitions = availableTransitions(proposal.status)

  return (
    <div className="space-y-6 pb-32">
      {/* Back link */}
      <Link
        to={`/app/projects/${project.id}?tab=proposals`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to project
      </Link>

      {/* Gradient header — QC blue. Inline-editable name on white-translucent input. */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="bg-white/20 p-2 rounded-lg shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <BlurSaveInput
                value={proposal.name}
                onSave={handleSaveName}
                disabled={readOnly}
                className="block w-full rounded-md border border-white/40 bg-white/10 px-2 py-1 text-2xl font-bold text-white outline-none placeholder:text-blue-100 hover:bg-white/15 focus:bg-white/20 focus:border-white/60 disabled:cursor-not-allowed disabled:bg-transparent disabled:hover:bg-transparent"
                placeholder="Proposal name"
              />
              <p className="mt-1 truncate text-sm text-blue-100">
                Project:{' '}
                <Link
                  to={`/app/projects/${project.id}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {project.name}
                </Link>
              </p>
            </div>
          </div>
          <StatusBadge
            kind="proposal"
            value={proposal.status}
            className="shrink-0 self-start bg-white/15 text-white ring-white/30"
          />
        </div>
      </div>

      {/* Phase 3c status banner — rendered when status != 'draft'.
          Status-tinted bar with copy + a quick "Revert to draft" CTA
          if available (presented / accepted / declined / completed all
          have at least one revert path). */}
      {readOnly && (
        <StatusBanner
          status={proposal.status}
          onRevertToDraft={() => {
            const revert = transitions.find((t) => t.target === 'draft')
            if (revert) setPendingTransition(revert)
          }}
        />
      )}

      {/* Toolbar — Save / Calculate functional; Download / Send disabled */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => void handleSaveAll()}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
          title={
            linesWithErrors.size > 0
              ? 'Fix line validation errors before saving.'
              : anyDirty
                ? 'Save changes'
                : 'No changes to save'
          }
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => void handleCalculate()}
          disabled={calculating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Calculator className="h-4 w-4" />
          {calculating ? 'Calculating…' : 'Calculate'}
        </button>

        {/* Status dropdown — available at every status; transitions
            allowed depend on the current value (availableTransitions). */}
        <StatusMenu
          status={proposal.status}
          transitions={transitions}
          open={statusMenuOpen}
          onToggle={() => setStatusMenuOpen((v) => !v)}
          onClose={() => setStatusMenuOpen(false)}
          onSelect={(t) => {
            setStatusMenuOpen(false)
            setPendingTransition(t)
          }}
        />

        {/* Phase 9-lite — Print / customer view */}
        <button
          type="button"
          onClick={() =>
            navigate(
              `/app/projects/${projectId}/proposals/${proposalId}/print`
            )
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          title="Open customer view to print or save as PDF"
        >
          <Printer className="h-4 w-4" />
          Print
        </button>

        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-200"
          title="Delete this proposal"
        >
          <Trash2 className="h-4 w-4" />
          Delete proposal
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm font-semibold text-gray-400"
          title="Coming in Prompt 9"
        >
          <Download className="h-4 w-4" />
          Download
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm font-semibold text-gray-400"
          title="Coming in Prompt 9"
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>

      {/* Items-need-pricing banner — between toolbar and Indigo Info card */}
      {itemsNeedingPricingCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-900">
                {itemsNeedingPricingCount} item
                {itemsNeedingPricingCount === 1 ? '' : 's'} need pricing
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                These items are at $0.00. Set prices in the line items below or
                in your{' '}
                <a
                  href="/app/catalog"
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  Item Catalog
                </a>{' '}
                before sending to client.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Indigo Proposal Info card */}
      <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
            <Info className="h-4 w-4 text-indigo-600" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-indigo-900">
            Proposal information
          </h2>
        </header>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          <ReadOnlyField label="Project">{project.name}</ReadOnlyField>
          <ReadOnlyField label="Status">
            <StatusBadge kind="proposal" value={proposal.status} />
          </ReadOnlyField>
          <ReadOnlyField label="Work areas">
            {proposal.work_areas.length}
          </ReadOnlyField>
          <ReadOnlyField label="Line items">{totalLineCount}</ReadOnlyField>
          <ReadOnlyField label="Created">
            {formatDateTime(proposal.created_at)}
          </ReadOnlyField>
          <ReadOnlyField label="Updated">
            {formatDateTime(proposal.updated_at)}
          </ReadOnlyField>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Notes
            </span>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              disabled={readOnly}
              rows={3}
              placeholder="Internal notes for this proposal."
              className={`${inputClasses} disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500`}
            />
          </label>
        </div>
      </section>

      {/* Slate Work Areas card — rich per-work-area cards with dnd-kit reorder */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
            <Layers className="h-4 w-4 text-slate-700" />
          </span>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Work areas — {proposal.work_areas.length}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Each work area gets its own card with per-category subsections.
              Drag the grip to reorder. Toggle the slider to exclude a work
              area from the grand total without losing its detail.
            </p>
          </div>
        </header>

        {proposal.work_areas.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <ClipboardList className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              No work areas yet
            </h3>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Add one to start building your proposal.
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={liveWorkAreas.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3">
                {liveWorkAreas.map((wa) => (
                  <ProposalWorkAreaSection
                    key={wa.id}
                    workArea={wa}
                    dirtyLineIds={dirtyLineIds}
                    linesWithErrors={linesWithErrors}
                    saving={saving}
                    readOnly={readOnly}
                    onLineChange={handleLineChange}
                    onLineDelete={handleLineDelete}
                    onLineReorder={handleLineReorder}
                    onChanged={() => void refreshAfterWorkAreaChange()}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {/* Permanent bottom affordance — always accessible whether the
            card list is empty or not. Per scope decision: these CTAs
            move from the empty state to a permanent strip so the
            contractor never has to scroll or change views to add.
            Hidden when readOnly — don't add new content to a sent
            proposal (Phase 3c). */}
        {!readOnly && (
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={() => setAddFromProjectOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              Add from project
            </button>
            <button
              type="button"
              onClick={() => setAddAdHocOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              Add ad-hoc
            </button>
          </div>
        )}
      </section>

      {/* Slate Totals card */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
            <Calculator className="h-4 w-4 text-slate-700" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Proposal total
          </h2>
        </header>
        {totals ? (
          <TotalsBreakdown totals={totals} proposal={proposal} />
        ) : (
          <p className="text-sm text-gray-500">Loading totals…</p>
        )}
      </section>

      {/* Sticky Save+Reset bar — unified, appears when notes OR lines dirty.
          Hidden when readOnly (Phase 3c) — no edits possible, no save state. */}
      {!readOnly && anyDirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-end gap-3">
            <p
              className={`mr-auto text-xs font-medium ${
                linesWithErrors.size > 0 ? 'text-rose-700' : 'text-gray-600'
              }`}
            >
              {linesWithErrors.size > 0 ? (
                <>
                  {linesWithErrors.size} line
                  {linesWithErrors.size === 1 ? '' : 's'} with errors — fix to save.
                </>
              ) : (
                buildDirtyLabel(linesDirtyCount, notesDirty)
              )}
            </p>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Modals + dialogs */}
      <AddWorkAreaFromProjectModal
        open={addFromProjectOpen}
        onClose={() => setAddFromProjectOpen(false)}
        proposalId={proposal.id}
        projectWorkAreas={projectWorkAreas}
        alreadyAttachedWorkAreaIds={alreadyAttachedWorkAreaIds}
        onAdded={() => void refreshAfterWorkAreaChange()}
      />
      <AddAdHocWorkAreaModal
        open={addAdHocOpen}
        onClose={() => setAddAdHocOpen(false)}
        proposalId={proposal.id}
        onAdded={() => void refreshAfterWorkAreaChange()}
      />

      {/* Phase 3c status transition confirm — dynamic copy per target
          status. transitioning state ensures double-click safety. */}
      <ConfirmDialog
        open={!!pendingTransition}
        onClose={() => !transitioning && setPendingTransition(null)}
        onConfirm={handleConfirmTransition}
        title={
          pendingTransition
            ? `Mark proposal as ${pendingTransition.target}?`
            : ''
        }
        description={
          pendingTransition
            ? transitionDescription(proposal.status, pendingTransition.target)
            : null
        }
        confirmLabel={pendingTransition?.label ?? 'Confirm'}
        tone={pendingTransition?.target === 'declined' ? 'danger' : 'primary'}
      />

      {/* P1-B: post-decline prompt — move the linked lead to Lost?
          Confirm, don't force (LOOP.md). Declining alone never moves
          the pipeline. */}
      <ConfirmDialog
        open={lostPromptLead !== null}
        onClose={() => setLostPromptLead(null)}
        onConfirm={async () => {
          if (lostPromptLead) {
            try {
              await updateLead(lostPromptLead.id, { stage: 'lost' })
              toast.success('Lead moved to Lost.')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't move lead.")
            }
          }
          setLostPromptLead(null)
        }}
        title="Move the lead to Lost too?"
        description={
          lostPromptLead
            ? `This project is linked to the lead "${lostPromptLead.name}". Mark that lead as Lost on the pipeline board? Skipping leaves it where it is.`
            : ''
        }
        confirmLabel="Mark lead as Lost"
        cancelLabel="Keep lead where it is"
        tone="danger"
      />

      {/* Delete-proposal confirm — dynamic copy with cascade preview +
          unsaved-changes warning when any dirty edit is pending. */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete proposal?"
        description={
          <>
            Delete <span className="font-semibold">"{proposal.name}"</span>?
            This permanently removes the proposal and all{' '}
            <span className="font-semibold">
              {proposal.work_areas.length} work area
              {proposal.work_areas.length === 1 ? '' : 's'}
            </span>{' '}
            +{' '}
            <span className="font-semibold">
              {proposal.work_areas.reduce((s, wa) => s + wa.lines.length, 0)} line
              item
              {proposal.work_areas.reduce((s, wa) => s + wa.lines.length, 0) === 1
                ? ''
                : 's'}
            </span>
            . This cannot be undone.
            {anyDirty && (
              <span className="mt-2 block rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                You have unsaved changes that will be lost.
              </span>
            )}
          </>
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function ReadOnlyField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  )
}


function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Populate the per-line draft + original maps from a freshly-loaded
 * proposal. Called on initial load + after every save / refresh so
 * the local state stays in sync with server truth.
 */
function primeLineState(
  p: ProposalWithWorkAreas,
  setLocal: (s: Record<string, ProposalLine>) => void,
  setOriginal: (s: Record<string, ProposalLine>) => void
) {
  const lookup: Record<string, ProposalLine> = {}
  for (const wa of p.work_areas) {
    for (const l of wa.lines) {
      lookup[l.id] = l
    }
  }
  setLocal({ ...lookup })
  setOriginal({ ...lookup })
}

/** Sticky-bar copy: combine line + notes dirty signals into one short line. */
function buildDirtyLabel(linesDirtyCount: number, notesDirty: boolean): string {
  const parts: string[] = []
  if (linesDirtyCount > 0) {
    parts.push(
      `${linesDirtyCount} unsaved line${linesDirtyCount === 1 ? '' : 's'}`
    )
  }
  if (notesDirty) parts.push('unsaved notes')
  return parts.join(' + ') + '.'
}

// StatusBanner / StatusMenu / transitionDescription extracted to
// components/proposals/ProposalStatusControls.tsx (P1-D cleanup 3).
