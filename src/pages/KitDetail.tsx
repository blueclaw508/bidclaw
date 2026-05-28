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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardList,
  Copy,
  GripVertical,
  Info,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Wrench,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { BlurSaveInput } from '@/components/InlineEdit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AddKitLineModal, type NewKitLineDraft } from '@/components/kits/AddKitLineModal'
import {
  ALL_FACTOR_UNITS,
  FACTOR_UNIT_GROUPS,
} from '@/components/kits/factorUnits'
import {
  addKitLine,
  archiveKit,
  deleteKit,
  deleteKitLine,
  duplicateKit,
  loadCatalogItemsForKitLines,
  loadEquipmentRatesForKitLines,
  loadKit,
  loadLaborTypesForKitLines,
  unarchiveKit,
  updateKit,
  updateKitLine,
} from '@/lib/kits'
import type {
  CatalogItem,
  CompanyEquipmentRate,
  CompanyLaborType,
  Kit,
  KitLine,
  KitLineReferenceType,
  KitLineType,
  KitWithLines,
} from '@/lib/types'

/**
 * Kit detail page. QC pastel pattern:
 *
 *   • Gradient header — Wrench icon, inline-editable name (save on
 *     blur, like ProjectDetail / CustomerDetail), kit summary line,
 *     status pill top-right.
 *   • Indigo Kit Info card — category, input unit, branch scope,
 *     Jamie notes. Save-bar pattern (local state + sticky Save+Reset).
 *   • Slate Line Items card — drag-drop table of kit_lines. Add via
 *     AddKitLineModal. All line edits stay local until Save.
 *   • Rose Danger Zone card — Archive / Duplicate / Delete. Each is
 *     immediate; Save bar disabled when dirty so the contractor can't
 *     archive over unsaved edits without noticing.
 *
 * The save bar diffs draft vs. original and patches in parallel.
 * Inserts (new lines), updates (dirty existing), deletes, and
 * position-only changes all share one Save click.
 */

/* ============================================================
 * Local draft types
 * ============================================================ */

interface LineDraft {
  /** Real DB id, or null when the line was added in this session. */
  id: string | null
  /** Stable React key — survives reorder and stays unique even when id is null. */
  _key: string
  type: KitLineType
  display_name: string
  reference_type: KitLineReferenceType
  reference_labor_type_id: string | null
  reference_equipment_rate_id: string | null
  reference_catalog_item_id: string | null
  factor: number | null
  factor_unit: string | null
  notes: string | null
  /** Marked when any field on an EXISTING line is touched. New lines (id===null) are implicitly dirty. */
  __dirty: boolean
}

interface KitHeaderDraft {
  category: string
  input_unit: string
  branch_scope: string
  jamie_notes: string
}

/* ============================================================
 * Page component
 * ============================================================ */

export default function KitDetailPage() {
  const { kitId } = useParams<{ kitId: string }>()
  const navigate = useNavigate()

  // Server snapshot — the floor for diff/reset
  const [original, setOriginal] = useState<KitWithLines | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Draft state for header (everything except name + status)
  const [draftHeader, setDraftHeader] = useState<KitHeaderDraft>({
    category: '',
    input_unit: '',
    branch_scope: '',
    jamie_notes: '',
  })

  // Draft state for lines + a set of DB ids to delete on save
  const [draftLines, setDraftLines] = useState<LineDraft[]>([])
  const [deletedLineIds, setDeletedLineIds] = useState<Set<string>>(new Set())

  // Reference lookups for the line item dropdowns
  const [laborTypes, setLaborTypes] = useState<
    Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  >([])
  const [equipmentRates, setEquipmentRates] = useState<
    Pick<CompanyEquipmentRate, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  >([])
  const [catalogItems, setCatalogItems] = useState<
    Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
  >([])

  // Modal / dialog state
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false)
  const [deleteLineTarget, setDeleteLineTarget] = useState<LineDraft | null>(null)

  // In-flight save guard
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!kitId) return
    setLoading(true)
    try {
      const [k, lt, er, ci] = await Promise.all([
        loadKit(kitId),
        loadLaborTypesForKitLines(),
        loadEquipmentRatesForKitLines(),
        loadCatalogItemsForKitLines(),
      ])
      if (!k) {
        setNotFound(true)
        return
      }
      setOriginal(k)
      setDraftHeader({
        category: k.category,
        input_unit: k.input_unit,
        branch_scope: k.branch_scope ?? '',
        jamie_notes: k.jamie_notes ?? '',
      })
      setDraftLines(k.lines.map(lineToDraft))
      setDeletedLineIds(new Set())
      setLaborTypes(lt)
      setEquipmentRates(er)
      setCatalogItems(ci)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load kit.')
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [kitId])

  useEffect(() => {
    void load()
  }, [load])

  /* ---------- name save-on-blur (immediate) ---------- */

  const handleSaveName = useCallback(
    async (next: string): Promise<boolean> => {
      if (!original) return false
      const trimmed = next.trim()
      if (!trimmed) {
        toast.error('Kit name cannot be empty.')
        return false
      }
      try {
        const updated = await updateKit(original.id, { name: trimmed })
        setOriginal((prev) => (prev ? { ...prev, ...updated } : prev))
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Save failed.')
        return false
      }
    },
    [original]
  )

  /* ---------- dirty check ---------- */

  const isDirty = useMemo(() => {
    if (!original) return false
    // Header
    if (draftHeader.category !== original.category) return true
    if (draftHeader.input_unit !== original.input_unit) return true
    if (draftHeader.branch_scope !== (original.branch_scope ?? '')) return true
    if (draftHeader.jamie_notes !== (original.jamie_notes ?? '')) return true
    // Lines — new lines, dirty lines, deletes, reorders
    if (deletedLineIds.size > 0) return true
    if (draftLines.some((l) => l.id === null || l.__dirty)) return true
    // Position diff
    const originalIdsInOrder = original.lines.map((l) => l.id)
    const draftExistingIdsInOrder = draftLines
      .filter((l) => l.id !== null)
      .map((l) => l.id as string)
    if (
      originalIdsInOrder.filter((id) => !deletedLineIds.has(id)).join(',') !==
      draftExistingIdsInOrder.join(',')
    )
      return true
    return false
  }, [original, draftHeader, draftLines, deletedLineIds])

  /* ---------- header patches ---------- */

  const patchHeader = useCallback(
    (changes: Partial<KitHeaderDraft>) => {
      setDraftHeader((prev) => ({ ...prev, ...changes }))
    },
    []
  )

  /* ---------- line patches ---------- */

  const patchLine = useCallback(
    (key: string, changes: Partial<LineDraft>) => {
      setDraftLines((prev) =>
        prev.map((l) =>
          l._key === key
            ? { ...l, ...changes, __dirty: l.id === null ? l.__dirty : true }
            : l
        )
      )
    },
    []
  )

  const patchLineType = useCallback((key: string, nextType: KitLineType) => {
    // Type change clears references — different types pull from
    // different lookups, so the previous FK is invalid.
    setDraftLines((prev) =>
      prev.map((l) =>
        l._key === key
          ? {
              ...l,
              type: nextType,
              reference_type: 'none' as KitLineReferenceType,
              reference_labor_type_id: null,
              reference_equipment_rate_id: null,
              reference_catalog_item_id: null,
              __dirty: l.id === null ? l.__dirty : true,
            }
          : l
      )
    )
  }, [])

  const patchLineReference = useCallback(
    (key: string, refId: string | null) => {
      setDraftLines((prev) =>
        prev.map((l) => {
          if (l._key !== key) return l
          // Clear all FKs first
          const cleared = {
            ...l,
            reference_type: 'none' as KitLineReferenceType,
            reference_labor_type_id: null,
            reference_equipment_rate_id: null,
            reference_catalog_item_id: null,
          }
          if (!refId) {
            return { ...cleared, __dirty: l.id === null ? l.__dirty : true }
          }
          switch (l.type) {
            case 'Labor':
              return {
                ...cleared,
                reference_type: 'labor_type',
                reference_labor_type_id: refId,
                __dirty: l.id === null ? l.__dirty : true,
              }
            case 'Equipment':
              return {
                ...cleared,
                reference_type: 'equipment_rate',
                reference_equipment_rate_id: refId,
                __dirty: l.id === null ? l.__dirty : true,
              }
            case 'Material':
              return {
                ...cleared,
                reference_type: 'catalog_item',
                reference_catalog_item_id: refId,
                __dirty: l.id === null ? l.__dirty : true,
              }
            default:
              return { ...cleared, __dirty: l.id === null ? l.__dirty : true }
          }
        })
      )
    },
    []
  )

  /* ---------- add line (from modal) ---------- */

  const handleAddLine = useCallback(
    (draft: NewKitLineDraft) => {
      setDraftLines((prev) => [
        ...prev,
        {
          id: null,
          _key: `new_${crypto.randomUUID()}`,
          type: draft.type,
          display_name: draft.display_name,
          reference_type: draft.reference_type,
          reference_labor_type_id: draft.reference_labor_type_id,
          reference_equipment_rate_id: draft.reference_equipment_rate_id,
          reference_catalog_item_id: draft.reference_catalog_item_id,
          factor: draft.factor,
          factor_unit: draft.factor_unit,
          notes: draft.notes,
          __dirty: false,
        },
      ])
    },
    []
  )

  /* ---------- delete line ---------- */

  const confirmDeleteLine = useCallback(() => {
    if (!deleteLineTarget) return
    setDraftLines((prev) => prev.filter((l) => l._key !== deleteLineTarget._key))
    // Existing line → schedule deletion on save. New line → just drop from local.
    if (deleteLineTarget.id) {
      setDeletedLineIds((prev) => {
        const next = new Set(prev)
        next.add(deleteLineTarget.id as string)
        return next
      })
    }
    setDeleteLineTarget(null)
  }, [deleteLineTarget])

  /* ---------- drag-drop reorder ---------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setDraftLines((prev) => {
      const oldIdx = prev.findIndex((l) => l._key === active.id)
      const newIdx = prev.findIndex((l) => l._key === over.id)
      if (oldIdx < 0 || newIdx < 0) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  /* ---------- per-line validation ---------- */
  // Two rules per spec section 7.3:
  //   • factor non-negative (NULL is fine — placeholder line)
  //   • factor_unit required when factor is set
  // Computed every render; cheap and avoids stale invalidation state.
  const lineValidations = useMemo(() => {
    const map = new Map<string, { factorInvalid: boolean; factorUnitMissing: boolean }>()
    for (const l of draftLines) {
      map.set(l._key, {
        factorInvalid: l.factor !== null && l.factor < 0,
        factorUnitMissing:
          l.factor !== null && (!l.factor_unit || l.factor_unit.trim() === ''),
      })
    }
    return map
  }, [draftLines])

  const hasValidationErrors = useMemo(() => {
    for (const v of lineValidations.values()) {
      if (v.factorInvalid || v.factorUnitMissing) return true
    }
    return false
  }, [lineValidations])

  /* ---------- Save ---------- */

  const handleSave = useCallback(async () => {
    if (!original || !kitId) return
    // Hard-block save when any line has validation errors. The Save
    // button is also disabled at the UI layer, but checking here too
    // covers programmatic invocation paths.
    if (hasValidationErrors) {
      toast.error('Fix the highlighted line errors before saving.')
      return
    }
    setSaving(true)
    try {
      // Build a flat list of promises to fire in parallel. Order within
      // the network round-trip doesn't matter; we reload at the end to
      // resync local state.
      const promises: Promise<unknown>[] = []

      // 1. Header patch — only changed fields
      const headerPatch: Partial<Kit> = {}
      if (draftHeader.category !== original.category)
        headerPatch.category = draftHeader.category.trim()
      if (draftHeader.input_unit !== original.input_unit)
        headerPatch.input_unit = draftHeader.input_unit.trim()
      if (draftHeader.branch_scope !== (original.branch_scope ?? ''))
        headerPatch.branch_scope = draftHeader.branch_scope.trim() || null
      if (draftHeader.jamie_notes !== (original.jamie_notes ?? ''))
        headerPatch.jamie_notes = draftHeader.jamie_notes.trim() || null
      if (Object.keys(headerPatch).length > 0) {
        promises.push(updateKit(kitId, headerPatch))
      }

      // 2. Deletes
      for (const id of deletedLineIds) {
        promises.push(deleteKitLine(id))
      }

      // 3. Per-line: insert new or update existing (with current position)
      for (let idx = 0; idx < draftLines.length; idx++) {
        const l = draftLines[idx]
        if (l.id === null) {
          promises.push(
            addKitLine(kitId, {
              position: idx,
              type: l.type,
              display_name: l.display_name.trim(),
              reference_type: l.reference_type,
              reference_labor_type_id: l.reference_labor_type_id,
              reference_equipment_rate_id: l.reference_equipment_rate_id,
              reference_catalog_item_id: l.reference_catalog_item_id,
              factor: l.factor,
              factor_unit: l.factor_unit?.trim() || null,
              notes: l.notes?.trim() || null,
            })
          )
        } else {
          // Only update if dirty OR if position changed
          const orig = original.lines.find((o) => o.id === l.id)
          const positionChanged = orig ? orig.position !== idx : true
          if (l.__dirty || positionChanged) {
            promises.push(
              updateKitLine(l.id, {
                type: l.type,
                display_name: l.display_name.trim(),
                reference_type: l.reference_type,
                reference_labor_type_id: l.reference_labor_type_id,
                reference_equipment_rate_id: l.reference_equipment_rate_id,
                reference_catalog_item_id: l.reference_catalog_item_id,
                factor: l.factor,
                factor_unit: l.factor_unit?.trim() || null,
                notes: l.notes?.trim() || null,
                position: idx,
              })
            )
          }
        }
      }

      await Promise.all(promises)

      // Reload to capture new line IDs + server-truth positions
      await load()
      toast.success('Saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }, [original, kitId, draftHeader, draftLines, deletedLineIds, hasValidationErrors, load])

  const handleReset = useCallback(() => {
    if (!original) return
    setDraftHeader({
      category: original.category,
      input_unit: original.input_unit,
      branch_scope: original.branch_scope ?? '',
      jamie_notes: original.jamie_notes ?? '',
    })
    setDraftLines(original.lines.map(lineToDraft))
    setDeletedLineIds(new Set())
  }, [original])

  /* ---------- Danger zone actions ---------- */

  const handleArchive = useCallback(async () => {
    if (!original) return
    if (isDirty) {
      toast.error('Save or reset your changes first.')
      return
    }
    try {
      await archiveKit(original.id)
      toast.success('Kit archived.')
      navigate('/app/kits')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Archive failed.')
    }
  }, [original, isDirty, navigate])

  const handleUnarchive = useCallback(async () => {
    if (!original) return
    if (isDirty) {
      toast.error('Save or reset your changes first.')
      return
    }
    try {
      const updated = await unarchiveKit(original.id)
      setOriginal((prev) => (prev ? { ...prev, ...updated } : prev))
      toast.success('Kit restored.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed.')
    }
  }, [original, isDirty])

  const handleConfirmDuplicate = useCallback(async () => {
    if (!original) return
    setDuplicateConfirmOpen(false)
    try {
      const copy = await duplicateKit(original.id, `${original.name} (Copy)`)
      toast.success('Kit duplicated.')
      navigate(`/app/kits/${copy.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate failed.')
    }
  }, [original, navigate])

  const handleConfirmDelete = useCallback(async () => {
    if (!original) return
    setDeleteConfirmOpen(false)
    try {
      await deleteKit(original.id)
      toast.success('Kit deleted.')
      navigate('/app/kits')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
    }
  }, [original, navigate])

  /* ---------- factor unit suggestions (from current lines) ---------- */

  const existingFactorUnits = useMemo(() => {
    const set = new Set<string>()
    for (const l of draftLines) {
      if (l.factor_unit) set.add(l.factor_unit)
    }
    return Array.from(set)
  }, [draftLines])

  /* ---------- render ---------- */

  if (loading && !original) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        Loading kit…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-bold text-rose-900">Kit not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This kit doesn't exist, or belongs to a different account.
        </p>
        <Link
          to="/app/kits"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to kits
        </Link>
      </div>
    )
  }

  if (!original) return null

  const archived = original.status === 'archived'

  return (
    <div className="space-y-6 pb-32">
      {/* Back link */}
      <Link
        to="/app/kits"
        className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to kits
      </Link>

      {/* Gradient header — QC blue, with inline-editable name */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="bg-white/20 p-2 rounded-lg shrink-0">
              <Wrench className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <BlurSaveInput
                value={original.name}
                onSave={handleSaveName}
                className="block w-full rounded-md border border-white/40 bg-white/10 px-2 py-1 text-2xl font-bold text-white outline-none placeholder:text-blue-100 hover:bg-white/15 focus:bg-white/20 focus:border-white/60"
                placeholder="Kit name"
              />
              <p className="mt-1 truncate text-sm text-blue-100">
                Category: {original.category} · Input: per {original.input_unit}
                {original.branch_scope ? ` · ${original.branch_scope}` : ''}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold ${
              archived
                ? 'bg-amber-100 text-amber-900'
                : 'bg-white/15 text-white'
            }`}
          >
            {archived ? 'Archived' : 'Active'}
          </span>
        </div>
      </div>

      {/* Indigo Kit Info card */}
      <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
            <Info className="h-4 w-4 text-indigo-600" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-indigo-900">
            Kit information
          </h2>
        </header>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field label="Category" required>
            <input
              type="text"
              value={draftHeader.category}
              onChange={(e) => patchHeader({ category: e.target.value })}
              className={inputClasses}
              placeholder="e.g. Paver"
            />
          </Field>
          <Field label="Input unit" required>
            <input
              type="text"
              value={draftHeader.input_unit}
              onChange={(e) => patchHeader({ input_unit: e.target.value })}
              className={inputClasses}
              placeholder="SF"
            />
          </Field>
          <Field label="Branch scope">
            <input
              type="text"
              value={draftHeader.branch_scope}
              onChange={(e) => patchHeader({ branch_scope: e.target.value })}
              className={inputClasses}
              placeholder="All Branches"
            />
          </Field>
          <div /> {/* spacer to keep notes full-width on the next row */}
          <Field label="Jamie notes" className="sm:col-span-2">
            <textarea
              value={draftHeader.jamie_notes}
              onChange={(e) => patchHeader({ jamie_notes: e.target.value })}
              rows={3}
              className={inputClasses}
              placeholder="Anything Jamie should know when picking this kit — typical use cases, gotchas, when to choose this vs a sibling kit."
            />
          </Field>
        </div>
      </section>

      {/* Slate Line Items card */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <ClipboardList className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Line items
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Each line's factor × kit input quantity becomes a proposal
                line item quantity. Drag the grip to reorder.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddLineOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Add line
          </button>
        </header>

        {draftLines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            No line items yet. Click <strong>Add line</strong> to start
            building the recipe.
          </div>
        ) : (
          <LineItemsTable
            lines={draftLines}
            validations={lineValidations}
            laborTypes={laborTypes}
            equipmentRates={equipmentRates}
            catalogItems={catalogItems}
            onPatch={patchLine}
            onPatchType={patchLineType}
            onPatchReference={patchLineReference}
            onDelete={(line) => setDeleteLineTarget(line)}
            sensors={sensors}
            onDragEnd={handleDragEnd}
          />
        )}
      </section>

      {/* Rose Danger Zone card */}
      <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/60 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-rose-900">
            Danger zone
          </h2>
        </header>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {archived ? (
            <button
              type="button"
              onClick={() => void handleUnarchive()}
              disabled={isDirty}
              className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-white px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              <ArchiveRestore className="h-4 w-4" />
              Restore kit
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={isDirty}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              Archive kit
            </button>
          )}
          <button
            type="button"
            onClick={() => setDuplicateConfirmOpen(true)}
            disabled={isDirty}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Duplicate kit
          </button>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={isDirty}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete kit
          </button>
          {isDirty && (
            <p className="text-xs italic text-rose-700">
              Save or reset your changes before archiving / duplicating /
              deleting.
            </p>
          )}
        </div>
      </section>

      {/* Sticky Save + Reset bar */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-end gap-3">
            <p
              className={`mr-auto text-xs font-medium ${
                hasValidationErrors ? 'text-rose-700' : 'text-gray-600'
              }`}
            >
              {hasValidationErrors
                ? 'Unsaved changes — fix the highlighted line errors to save.'
                : 'Unsaved changes.'}
            </p>
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || hasValidationErrors}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Shared factor-unit datalist for the inline LineRow inputs.
          AddKitLineModal renders its own datalist (id="kit-line-factor-units")
          so we use a distinct id here to avoid duplicate-id-in-DOM when
          both surfaces are mounted simultaneously. Both pull from the
          same shared FACTOR_UNIT_GROUPS constant for visual parity. */}
      <datalist id="kit-line-factor-units-row">
        {(() => {
          const standard = new Set(ALL_FACTOR_UNITS)
          const customs = existingFactorUnits.filter((u) => u && !standard.has(u))
          return (
            <>
              {customs.length > 0 && (
                <optgroup label="In this kit">
                  {customs.map((u) => (
                    <option key={`row-custom-${u}`} value={u} />
                  ))}
                </optgroup>
              )}
              {FACTOR_UNIT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.units.map((u) => (
                    <option key={`row-${g.label}-${u}`} value={u} />
                  ))}
                </optgroup>
              ))}
            </>
          )
        })()}
      </datalist>

      {/* Modals */}
      <AddKitLineModal
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        onAdd={handleAddLine}
        laborTypes={laborTypes}
        equipmentRates={equipmentRates}
        catalogItems={catalogItems}
        existingFactorUnits={existingFactorUnits}
      />

      <ConfirmDialog
        open={!!deleteLineTarget}
        onClose={() => setDeleteLineTarget(null)}
        onConfirm={confirmDeleteLine}
        title="Remove this line?"
        description={
          deleteLineTarget ? (
            <>
              <strong className="text-brand-text">
                {deleteLineTarget.display_name}
              </strong>{' '}
              will be removed from this kit when you save.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Remove"
        tone="danger"
      />

      <ConfirmDialog
        open={duplicateConfirmOpen}
        onClose={() => setDuplicateConfirmOpen(false)}
        onConfirm={() => void handleConfirmDuplicate()}
        title="Duplicate this kit?"
        description={
          <>
            A copy named <strong>{original.name} (Copy)</strong> will be
            created with all <strong>{original.lines.length}</strong> line
            item{original.lines.length === 1 ? '' : 's'}. You'll be taken to
            the copy so you can rename and edit it.
          </>
        }
        confirmLabel="Duplicate"
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete this kit?"
        description={
          <>
            <strong className="text-brand-text">{original.name}</strong> and
            all <strong>{original.lines.length}</strong> of its line item
            {original.lines.length === 1 ? '' : 's'} will be permanently
            deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete kit"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * LineItemsTable — drag-drop sortable table of kit_lines
 * ============================================================ */

interface LineValidation {
  factorInvalid: boolean
  factorUnitMissing: boolean
}

function LineItemsTable({
  lines,
  validations,
  laborTypes,
  equipmentRates,
  catalogItems,
  onPatch,
  onPatchType,
  onPatchReference,
  onDelete,
  sensors,
  onDragEnd,
}: {
  lines: LineDraft[]
  validations: Map<string, LineValidation>
  laborTypes: Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  equipmentRates: Pick<
    CompanyEquipmentRate,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
  catalogItems: Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
  onPatch: (key: string, changes: Partial<LineDraft>) => void
  onPatchType: (key: string, type: KitLineType) => void
  onPatchReference: (key: string, refId: string | null) => void
  onDelete: (line: LineDraft) => void
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (e: DragEndEvent) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* Desktop column header */}
      <div className="hidden grid-cols-[24px_100px_minmax(0,1.5fr)_minmax(0,1.5fr)_90px_90px_32px] gap-3 border-b border-gray-100 bg-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div />
        <div>Type</div>
        <div>Display name</div>
        <div>Reference</div>
        <div>Factor</div>
        <div>Unit</div>
        <div />
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext
          items={lines.map((l) => l._key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-y divide-gray-100">
            {lines.map((line) => (
              <LineRow
                key={line._key}
                line={line}
                validation={
                  validations.get(line._key) ?? {
                    factorInvalid: false,
                    factorUnitMissing: false,
                  }
                }
                laborTypes={laborTypes}
                equipmentRates={equipmentRates}
                catalogItems={catalogItems}
                onPatch={onPatch}
                onPatchType={onPatchType}
                onPatchReference={onPatchReference}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

/* ============================================================
 * LineRow — single editable line, sortable via dnd-kit
 * ============================================================ */

function LineRow({
  line,
  validation,
  laborTypes,
  equipmentRates,
  catalogItems,
  onPatch,
  onPatchType,
  onPatchReference,
  onDelete,
}: {
  line: LineDraft
  validation: LineValidation
  laborTypes: Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  equipmentRates: Pick<
    CompanyEquipmentRate,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
  catalogItems: Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
  onPatch: (key: string, changes: Partial<LineDraft>) => void
  onPatchType: (key: string, type: KitLineType) => void
  onPatchReference: (key: string, refId: string | null) => void
  onDelete: (line: LineDraft) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: line._key })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const showReferenceDropdown =
    line.type === 'Labor' || line.type === 'Material' || line.type === 'Equipment'

  // Current reference id resolved from the appropriate FK column
  const currentRefId =
    line.reference_type === 'labor_type'
      ? line.reference_labor_type_id
      : line.reference_type === 'equipment_rate'
        ? line.reference_equipment_rate_id
        : line.reference_type === 'catalog_item'
          ? line.reference_catalog_item_id
          : null

  // Detect: user picked a reference, but the FK is NULL → upstream
  // entity was deleted via cascade SET NULL.
  const referenceMissing = line.reference_type !== 'none' && currentRefId === null

  const factorText = line.factor === null ? '' : String(line.factor)

  // Validation styles — tinted background + amber/rose border. Title
  // attribute carries the explanation for desktop hover (mobile users
  // get the explanatory text below the sticky save bar).
  const factorCellClasses = validation.factorInvalid
    ? `${cellInputClasses} border-rose-400 bg-rose-50`
    : cellInputClasses
  const factorUnitCellClasses = validation.factorUnitMissing
    ? `${cellInputClasses} border-rose-400 bg-rose-50`
    : cellInputClasses
  const factorTitle = validation.factorInvalid
    ? 'Factor must be 0 or greater.'
    : undefined
  const factorUnitTitle = validation.factorUnitMissing
    ? 'Factor unit is required when factor is set.'
    : undefined

  return (
    <li ref={setNodeRef} style={style} className="bg-white">
      {/* Desktop grid */}
      <div className="hidden grid-cols-[24px_100px_minmax(0,1.5fr)_minmax(0,1.5fr)_90px_90px_32px] items-center gap-3 px-3 py-2 lg:grid">
        <button
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <select
          value={line.type}
          onChange={(e) => onPatchType(line._key, e.target.value as KitLineType)}
          className={cellInputClasses}
        >
          <option value="Labor">Labor</option>
          <option value="Material">Material</option>
          <option value="Equipment">Equipment</option>
          <option value="Sub">Sub</option>
          <option value="Other">Other</option>
        </select>
        <input
          type="text"
          value={line.display_name}
          onChange={(e) => onPatch(line._key, { display_name: e.target.value })}
          placeholder="Line label"
          className={cellInputClasses}
        />
        <div className="min-w-0">
          {showReferenceDropdown ? (
            <ReferenceSelect
              line={line}
              laborTypes={laborTypes}
              equipmentRates={equipmentRates}
              catalogItems={catalogItems}
              currentRefId={currentRefId}
              onChange={(id) => onPatchReference(line._key, id)}
              missing={referenceMissing}
            />
          ) : (
            <span className="text-xs italic text-gray-400">—</span>
          )}
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={factorText}
          onChange={(e) => {
            const v = e.target.value
            if (v.trim() === '') {
              onPatch(line._key, { factor: null })
              return
            }
            const n = Number(v)
            if (Number.isFinite(n)) {
              onPatch(line._key, { factor: n })
            }
          }}
          placeholder="0.00"
          className={factorCellClasses}
          title={factorTitle}
        />
        <input
          type="text"
          list="kit-line-factor-units-row"
          value={line.factor_unit ?? ''}
          onChange={(e) =>
            onPatch(line._key, { factor_unit: e.target.value || null })
          }
          placeholder="Hr/SF"
          className={factorUnitCellClasses}
          title={factorUnitTitle}
        />
        <button
          type="button"
          onClick={() => onDelete(line)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-rose-50 hover:text-rose-700"
          title="Remove line"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile stacked card */}
      <div className="flex flex-col gap-2 px-4 py-3 lg:hidden">
        <div className="flex items-start gap-2">
          <button
            {...listeners}
            {...attributes}
            aria-label="Drag to reorder"
            className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <select
            value={line.type}
            onChange={(e) =>
              onPatchType(line._key, e.target.value as KitLineType)
            }
            className={`${cellInputClasses} flex-1`}
          >
            <option value="Labor">Labor</option>
            <option value="Material">Material</option>
            <option value="Equipment">Equipment</option>
            <option value="Sub">Sub</option>
            <option value="Other">Other</option>
          </select>
          <button
            type="button"
            onClick={() => onDelete(line)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-rose-50 hover:text-rose-700"
            title="Remove line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <input
          type="text"
          value={line.display_name}
          onChange={(e) => onPatch(line._key, { display_name: e.target.value })}
          placeholder="Line label"
          className={cellInputClasses}
        />
        {showReferenceDropdown && (
          <ReferenceSelect
            line={line}
            laborTypes={laborTypes}
            equipmentRates={equipmentRates}
            catalogItems={catalogItems}
            currentRefId={currentRefId}
            onChange={(id) => onPatchReference(line._key, id)}
            missing={referenceMissing}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={factorText}
            onChange={(e) => {
              const v = e.target.value
              if (v.trim() === '') {
                onPatch(line._key, { factor: null })
                return
              }
              const n = Number(v)
              if (Number.isFinite(n)) {
                onPatch(line._key, { factor: n })
              }
            }}
            placeholder="Factor"
            className={factorCellClasses}
          />
          <input
            type="text"
            list="kit-line-factor-units-row"
            value={line.factor_unit ?? ''}
            onChange={(e) =>
              onPatch(line._key, { factor_unit: e.target.value || null })
            }
            placeholder="Unit"
            className={factorUnitCellClasses}
          />
        </div>
        {(validation.factorInvalid || validation.factorUnitMissing) && (
          <p className="flex items-center gap-1 text-[10px] font-medium text-rose-700">
            <AlertTriangle className="h-3 w-3" />
            {validation.factorInvalid
              ? 'Factor must be 0 or greater.'
              : 'Factor unit is required when factor is set.'}
          </p>
        )}
      </div>
    </li>
  )
}

/* ============================================================
 * ReferenceSelect — type-aware reference dropdown
 * ============================================================ */

function ReferenceSelect({
  line,
  laborTypes,
  equipmentRates,
  catalogItems,
  currentRefId,
  onChange,
  missing,
}: {
  line: LineDraft
  laborTypes: Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  equipmentRates: Pick<
    CompanyEquipmentRate,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
  catalogItems: Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
  currentRefId: string | null
  onChange: (id: string | null) => void
  missing: boolean
}) {
  return (
    <div className="min-w-0">
      <select
        value={currentRefId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${cellInputClasses} ${missing ? 'border-amber-400 bg-amber-50' : ''}`}
      >
        <option value="">(no reference)</option>
        {line.type === 'Labor' &&
          laborTypes
            .filter((l) => l.name && l.name.trim().length > 0)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        {line.type === 'Equipment' &&
          equipmentRates
            .filter((e) => e.name && e.name.trim().length > 0)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        {line.type === 'Material' &&
          catalogItems.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.unit})
            </option>
          ))}
      </select>
      {missing && (
        <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          Reference deleted — pick a new one
        </p>
      )}
    </div>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

function lineToDraft(line: KitLine): LineDraft {
  return {
    id: line.id,
    _key: line.id,
    type: line.type,
    display_name: line.display_name,
    reference_type: line.reference_type,
    reference_labor_type_id: line.reference_labor_type_id,
    reference_equipment_rate_id: line.reference_equipment_rate_id,
    reference_catalog_item_id: line.reference_catalog_item_id,
    factor: line.factor,
    factor_unit: line.factor_unit,
    notes: line.notes,
    __dirty: false,
  }
}

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

const cellInputClasses =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  )
}
