import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  RotateCcw,
  Save,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { BlurSaveInput } from '@/components/InlineEdit'
import { StatusBadge } from '@/components/StatusBadge'
import { AddWorkAreaFromProjectModal } from '@/components/proposals/AddWorkAreaFromProjectModal'
import { AddAdHocWorkAreaModal } from '@/components/proposals/AddAdHocWorkAreaModal'
import ProposalWorkAreaSection from '@/components/proposals/ProposalWorkAreaSection'
import { supabase } from '@/lib/supabase'
import {
  deleteProposalLine,
  getProposal,
  getProposalTotals,
  reorderProposalWorkAreas,
  syncProposalWorkAreaSubtotals,
  updateProposal,
  updateProposalLine,
} from '@/lib/proposals'
import { lineHasErrors } from '@/components/proposals/ProposalLineRow'
import type {
  Project,
  ProposalLine,
  ProposalLineCategory,
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

  // Server snapshot — floor for diff/reset on notes
  const [proposal, setProposal] = useState<ProposalWithWorkAreas | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [projectWorkAreas, setProjectWorkAreas] = useState<WorkArea[]>([])
  const [totals, setTotals] = useState<TotalsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Notes draft state (Save+Reset bar pattern)
  const [notesDraft, setNotesDraft] = useState<string>('')

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
      // Dirty line patches (each auto-syncs its pwa subtotals via the
      // Phase 2c data-layer guard — redundant when multiple lines on
      // the same pwa change, but functionally correct; can batch in a
      // Phase 1.5 polish pass).
      for (const id of dirtyLineIds) {
        const l = localLines[id]
        ops.push(
          updateProposalLine(id, {
            label: l.label.trim(),
            quantity: Number(l.quantity),
            frozen_unit_cost: Number(l.frozen_unit_cost),
            sort_order: l.sort_order,
          })
        )
      }
      // Deletes
      for (const id of deletedLineIds) {
        ops.push(deleteProposalLine(id))
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
                className="block w-full rounded-md border border-white/40 bg-white/10 px-2 py-1 text-2xl font-bold text-white outline-none placeholder:text-blue-100 hover:bg-white/15 focus:bg-white/20 focus:border-white/60"
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
              rows={3}
              placeholder="Internal notes for this proposal."
              className={inputClasses}
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
            contractor never has to scroll or change views to add. */}
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

      {/* Sticky Save+Reset bar — unified, appears when notes OR lines dirty */}
      {anyDirty && (
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
    </div>
  )
}

/* ============================================================
 * Totals breakdown — per-category subtotals + markup + grand
 * ============================================================ */

const CATEGORY_LABELS: Record<ProposalLineCategory, string> = {
  labor: 'Labor',
  material: 'Materials',
  equipment: 'Equipment',
  subcontractor: 'Subcontractor',
  other: 'Other',
}

function TotalsBreakdown({
  totals,
  proposal,
}: {
  totals: TotalsView
  proposal: ProposalWithWorkAreas
}) {
  // Per-category rollup: base (pre-markup) + markup amount. Computed
  // from line-level data — only enabled work areas contribute. Disabled
  // work areas still show their own subtotals on their cards but are
  // excluded from grand total per the architecture decision locked at
  // Phase 2c.
  const rollup: Record<ProposalLineCategory, { base: number; markup: number }> = {
    labor: { base: 0, markup: 0 },
    material: { base: 0, markup: 0 },
    equipment: { base: 0, markup: 0 },
    subcontractor: { base: 0, markup: 0 },
    other: { base: 0, markup: 0 },
  }
  for (const wa of proposal.work_areas) {
    if (!wa.enabled) continue
    for (const l of wa.lines) {
      const lineTotal = Number(l.quantity) * Number(l.frozen_unit_cost)
      const lineMarkup = lineTotal * (Number(l.frozen_markup_percent) / 100)
      rollup[l.category].base += lineTotal
      rollup[l.category].markup += lineMarkup
    }
  }

  const visibleCategories = (Object.keys(rollup) as ProposalLineCategory[]).filter(
    (cat) => rollup[cat].base > 0 || rollup[cat].markup > 0
  )

  if (visibleCategories.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 bg-slate-50 px-4 py-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Proposal total
          </h3>
        </header>
        <div className="px-4 py-6 text-center text-xs italic text-gray-400">
          No line items yet.
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <header className="border-b border-gray-100 bg-slate-50 px-4 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          Proposal total
        </h3>
      </header>

      {/* Desktop tabular layout — Base / Markup / Total columns */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2 text-left font-semibold">Category</th>
            <th className="px-4 py-2 text-right font-semibold">Base</th>
            <th className="px-4 py-2 text-right font-semibold">Markup</th>
            <th className="px-4 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visibleCategories.map((cat) => {
            const { base, markup } = rollup[cat]
            return (
              <tr key={cat}>
                <td className="px-4 py-2 font-medium text-gray-700">
                  {CATEGORY_LABELS[cat]}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatUSD(base)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                  {markup > 0 ? `+ ${formatUSD(markup)}` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {formatUSD(base + markup)}
                </td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-gray-200 bg-brand-navy/5">
            <td colSpan={3} className="px-4 py-3 text-base font-bold text-gray-900">
              GRAND TOTAL
            </td>
            <td className="px-4 py-3 text-right text-lg font-bold tabular-nums text-brand-navy">
              {formatUSD(totals.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Mobile stacked layout — per-category card with Base / Markup / Total dl */}
      <div className="space-y-3 px-4 py-3 sm:hidden">
        {visibleCategories.map((cat) => {
          const { base, markup } = rollup[cat]
          return (
            <div
              key={cat}
              className="rounded-lg border border-gray-100 p-3"
            >
              <div className="text-sm font-semibold text-gray-900">
                {CATEGORY_LABELS[cat]}
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Base</dt>
                  <dd className="tabular-nums text-gray-900">{formatUSD(base)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Markup</dt>
                  <dd className="tabular-nums text-gray-700">
                    {markup > 0 ? `+ ${formatUSD(markup)}` : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-1">
                  <dt className="font-semibold text-gray-700">Total</dt>
                  <dd className="font-semibold tabular-nums text-gray-900">
                    = {formatUSD(base + markup)}
                  </dd>
                </div>
              </dl>
            </div>
          )
        })}
        <div className="flex items-center justify-between rounded-lg bg-brand-navy/5 p-3">
          <span className="text-base font-bold text-gray-900">GRAND TOTAL</span>
          <span className="text-lg font-bold tabular-nums text-brand-navy">
            {formatUSD(totals.grandTotal)}
          </span>
        </div>
      </div>
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

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
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
