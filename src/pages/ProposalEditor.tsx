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
  getProposal,
  getProposalTotals,
  reorderProposalWorkAreas,
  updateProposal,
} from '@/lib/proposals'
import type {
  Project,
  ProposalLineCategory,
  ProposalWithWorkAreas,
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

  // Current settings markup % — displayed as a reference indicator on
  // each work area subsection header (frozen markup on actual lines
  // may differ from this if rates changed since the line was added).
  const [materialsMarkupPercent, setMaterialsMarkupPercent] = useState(0)
  const [subsMarkupPercent, setSubsMarkupPercent] = useState(0)

  // Notes draft state (Save+Reset bar pattern)
  const [notesDraft, setNotesDraft] = useState<string>('')
  const [savingNotes, setSavingNotes] = useState(false)

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

      // Fetch the parent project (for the header subtitle), project's
      // work areas (for the "Add from project" modal), and current
      // settings markup % (for the per-section reference indicator).
      // All three in parallel — small payloads.
      const [
        { data: proj, error: pErr },
        { data: was, error: wErr },
        { data: settings, error: sErr },
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
        supabase
          .from('company_settings')
          .select('markup_materials_percent, markup_subs_percent')
          .maybeSingle(),
      ])
      if (pErr) throw new Error(`Couldn't load project: ${pErr.message}`)
      if (!proj) throw new Error('Project not found.')
      setProject(proj as Project)
      if (wErr) throw new Error(`Couldn't load project work areas: ${wErr.message}`)
      setProjectWorkAreas((was ?? []) as WorkArea[])
      if (sErr) throw new Error(`Couldn't load company settings: ${sErr.message}`)
      setMaterialsMarkupPercent(Number(settings?.markup_materials_percent ?? 0))
      setSubsMarkupPercent(Number(settings?.markup_subs_percent ?? 0))

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

  /* ---------- notes save bar ---------- */

  const notesDirty = useMemo(() => {
    if (!proposal) return false
    return notesDraft !== (proposal.notes ?? '')
  }, [notesDraft, proposal])

  const handleSaveNotes = useCallback(async () => {
    if (!proposal) return
    setSavingNotes(true)
    try {
      const updated = await updateProposal(proposal.id, {
        notes: notesDraft.trim() ? notesDraft : null,
      })
      setProposal((prev) => (prev ? { ...prev, ...updated } : prev))
      toast.success('Notes saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSavingNotes(false)
    }
  }, [proposal, notesDraft])

  const handleResetNotes = useCallback(() => {
    if (!proposal) return
    setNotesDraft(proposal.notes ?? '')
  }, [proposal])

  /* ---------- calculate button ---------- */

  const handleCalculate = useCallback(async () => {
    if (!proposalId) return
    setCalculating(true)
    try {
      const fresh = await getProposalTotals(proposalId)
      setTotals(fresh)
      toast.success('Totals refreshed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Calculate failed.')
    } finally {
      setCalculating(false)
    }
  }, [proposalId])

  /* ---------- work area add/remove ---------- */

  const refreshAfterWorkAreaChange = useCallback(async () => {
    if (!proposalId) return
    try {
      const [p, t] = await Promise.all([
        getProposal(proposalId),
        getProposalTotals(proposalId),
      ])
      if (p) setProposal(p)
      setTotals(t)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed.')
    }
  }, [proposalId])

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
          onClick={() => void handleSaveNotes()}
          disabled={!notesDirty || savingNotes}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
          title={notesDirty ? 'Save notes' : 'No changes to save'}
        >
          <Save className="h-4 w-4" />
          {savingNotes ? 'Saving…' : 'Save'}
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
              items={proposal.work_areas.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3">
                {proposal.work_areas.map((wa) => (
                  <ProposalWorkAreaSection
                    key={wa.id}
                    workArea={wa}
                    materialsMarkupPercent={materialsMarkupPercent}
                    subsMarkupPercent={subsMarkupPercent}
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
          <TotalsBreakdown totals={totals} />
        ) : (
          <p className="text-sm text-gray-500">Loading totals…</p>
        )}
      </section>

      {/* Sticky Save+Reset bar — appears when notes dirty */}
      {notesDirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-end gap-3">
            <p className="mr-auto text-xs font-medium text-gray-600">
              Unsaved notes.
            </p>
            <button
              type="button"
              onClick={handleResetNotes}
              disabled={savingNotes}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSaveNotes()}
              disabled={savingNotes}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {savingNotes ? 'Saving…' : 'Save'}
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

function TotalsBreakdown({ totals }: { totals: TotalsView }) {
  // Sum byCategory across all work areas (we display proposal-wide
  // totals here; per-work-area breakdown is on each work area card in
  // Phase 2e).
  const byCategory: Record<ProposalLineCategory, number> = {
    labor: 0,
    material: 0,
    equipment: 0,
    subcontractor: 0,
    other: 0,
  }
  for (const wa of totals.workAreas) {
    if (!wa.enabled) continue
    for (const cat of Object.keys(byCategory) as ProposalLineCategory[]) {
      byCategory[cat] += wa.byCategory[cat]
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {(Object.keys(byCategory) as ProposalLineCategory[]).map((cat) => {
            const v = byCategory[cat]
            if (v === 0) return null
            return (
              <tr key={cat}>
                <td className="px-4 py-2 text-gray-700">{CATEGORY_LABELS[cat]}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatUSD(v)}
                </td>
              </tr>
            )
          })}
          <tr className="bg-slate-50">
            <td className="px-4 py-2 font-semibold text-gray-700">Subtotal</td>
            <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
              {formatUSD(totals.grandSubtotal)}
            </td>
          </tr>
          <tr className="bg-slate-50">
            <td className="px-4 py-2 text-gray-700">Markup</td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-900">
              {formatUSD(totals.grandMarkupAmount)}
            </td>
          </tr>
          <tr className="bg-brand-navy/5">
            <td className="px-4 py-3 text-base font-bold text-gray-900">
              Grand total
            </td>
            <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-brand-navy">
              {formatUSD(totals.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
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
