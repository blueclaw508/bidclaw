import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { NewKitModal } from '@/components/kits/NewKitModal'
import {
  AddKitLineModal,
  type NewKitLineDraft,
} from '@/components/kits/AddKitLineModal'
import {
  addKitLine,
  loadCatalogItemsForKitLines,
  loadEquipmentRatesForKitLines,
  loadKits,
  loadLaborTypesForKitLines,
} from '@/lib/kits'
import { previewKitLines } from '@/lib/proposals'
import { formatUSD } from '@/lib/money'
import type { Kit, KitPreviewLine } from '@/lib/types'

/**
 * Kit → estimate bulk add (R3; deferred from R2). Lean three-step:
 * pick kit → input quantity → preview + select → add.
 *
 * Reuses previewKitLines (pure read: factors × input qty, unit costs
 * resolved from catalog / labor / equipment refs). The preview's
 * frozen_markup_percent is IGNORED — estimate lines render live
 * markup from current settings (QC model). frozen_unit_cost is the
 * resolved BASE cost → becomes unit_cost.
 *
 * Placeholder lines (missing factor or cost) are listed but default
 * UNCHECKED — checking one adds it at qty 0 / $0 for inline completion
 * (estimates allow qty 0, unlike frozen proposal lines).
 *
 * On-the-fly kit creation: "+ New" opens NewKitModal (reused); the
 * created kit is auto-selected and AddKitLineModal (reused) opens so
 * lines can be added without leaving the estimate. Lines persist
 * immediately via addKitLine (no KitDetail save bar here).
 */

interface KitToEstimateModalProps {
  open: boolean
  onClose: () => void
  workAreaName: string
  /** Bulk-adds the selected preview lines. Parent owns state + DB. */
  onAdd: (lines: KitPreviewLine[]) => Promise<void>
}

export function KitToEstimateModal({
  open,
  onClose,
  workAreaName,
  onAdd,
}: KitToEstimateModalProps) {
  const [kits, setKits] = useState<Kit[] | null>(null)
  const [kitId, setKitId] = useState('')
  const [inputQty, setInputQty] = useState<number | null>(null)
  const [preview, setPreview] = useState<KitPreviewLine[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  // On-the-fly kit creation
  const [showNewKit, setShowNewKit] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [createdKitId, setCreatedKitId] = useState<string | null>(null)
  const [createdLineCount, setCreatedLineCount] = useState(0)
  const [lineRefs, setLineRefs] = useState<{
    laborTypes: Awaited<ReturnType<typeof loadLaborTypesForKitLines>>
    equipmentRates: Awaited<ReturnType<typeof loadEquipmentRatesForKitLines>>
    catalogItems: Awaited<ReturnType<typeof loadCatalogItemsForKitLines>>
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setKitId('')
    setInputQty(null)
    setPreview(null)
    setChecked(new Set())
    setBusy(false)
    setShowNewKit(false)
    setShowAddLine(false)
    setCreatedKitId(null)
    setCreatedLineCount(0)
    loadKits()
      .then((ks) => setKits(ks.filter((k) => k.status === 'active')))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Could not load kits.')
      )
  }, [open])

  // Reference options for AddKitLineModal — loaded once, on first need.
  useEffect(() => {
    if (!showAddLine || lineRefs) return
    Promise.all([
      loadLaborTypesForKitLines(),
      loadEquipmentRatesForKitLines(),
      loadCatalogItemsForKitLines(),
    ])
      .then(([laborTypes, equipmentRates, catalogItems]) =>
        setLineRefs({ laborTypes, equipmentRates, catalogItems })
      )
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : 'Could not load line options.'
        )
      )
  }, [showAddLine, lineRefs])

  const selectedKit = useMemo(
    () => kits?.find((k) => k.id === kitId) ?? null,
    [kits, kitId]
  )

  const handleKitCreated = (kit: Kit) => {
    setKits((prev) => (prev ? [...prev, kit] : [kit]))
    setKitId(kit.id)
    setPreview(null)
    setChecked(new Set())
    setCreatedKitId(kit.id)
    setCreatedLineCount(0)
    // Straight into line entry — a header-only kit previews to nothing.
    setShowAddLine(true)
  }

  const handleLineDraft = async (draft: NewKitLineDraft) => {
    if (!createdKitId) return
    try {
      await addKitLine(createdKitId, {
        position: createdLineCount,
        type: draft.type,
        display_name: draft.display_name,
        reference_type: draft.reference_type,
        reference_labor_type_id: draft.reference_labor_type_id,
        reference_equipment_rate_id: draft.reference_equipment_rate_id,
        reference_catalog_item_id: draft.reference_catalog_item_id,
        factor: draft.factor,
        factor_unit: draft.factor_unit,
        notes: draft.notes,
      })
      setCreatedLineCount((n) => n + 1)
      setPreview(null) // stale — re-preview picks up the new line
      toast.success(`Line added to ${selectedKit?.name ?? 'kit'}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add line.')
    }
  }

  const handlePreview = async () => {
    if (!kitId || !inputQty || inputQty <= 0) return
    setBusy(true)
    try {
      const lines = await previewKitLines({ kitId, inputQuantity: inputQty })
      setPreview(lines)
      // Real lines checked by default; placeholders (needs input) unchecked.
      setChecked(new Set(lines.map((l, i) => (l.placeholder ? -1 : i)).filter((i) => i >= 0)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = async () => {
    if (!preview) return
    const lines = preview.filter((_, i) => checked.has(i))
    if (lines.length === 0) return
    setBusy(true)
    try {
      await onAdd(lines)
      toast.success(`${lines.length} line${lines.length === 1 ? '' : 's'} added from kit.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed.')
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Add from Kit"
      description={`Bulk-add assembly lines to ${workAreaName}. Quantities = kit factors × your input quantity.`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Kit + input qty */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Kit
            </span>
            <div className="flex gap-2">
              <select
                value={kitId}
                onChange={(e) => {
                  setKitId(e.target.value)
                  setPreview(null)
                }}
                disabled={busy || kits === null}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              >
                <option value="">{kits === null ? 'Loading kits…' : 'Select a kit…'}</option>
                {(kits ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewKit(true)}
                disabled={busy}
                title="Create a new kit without leaving the estimate"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-brand-navy hover:border-brand-navy hover:bg-brand-navy/5 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                New
              </button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Input qty{selectedKit ? ` (${selectedKit.input_unit})` : ''}
            </span>
            <DecimalInput
              value={inputQty}
              onCommit={setInputQty}
              placeholder="0"
              disabled={busy}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-right text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={!kitId || !inputQty || inputQty <= 0 || busy}
              className="rounded-lg border border-brand-navy px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-navy/5 disabled:opacity-50"
            >
              Preview
            </button>
          </div>
        </div>

        {/* Freshly created kit: line entry panel */}
        {createdKitId && kitId === createdKitId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-amber-800">
                <span className="font-semibold">{selectedKit?.name}</span> —{' '}
                {createdLineCount === 0
                  ? 'new kit, no lines yet. Add the assembly lines, then Preview.'
                  : `${createdLineCount} line${createdLineCount === 1 ? '' : 's'} added. Add more or hit Preview.`}
              </p>
              <button
                type="button"
                onClick={() => setShowAddLine(true)}
                disabled={busy}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add kit line
              </button>
            </div>
          </div>
        )}

        {/* Preview list */}
        {preview && (
          <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-gray-200">
            <ul className="divide-y divide-gray-100">
              {preview.map((l, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(i)
                        else next.delete(i)
                        return next
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy/30"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {l.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {l.placeholder ? (
                        <span className="font-semibold text-amber-600">
                          Needs input — adds at qty 0 for inline completion
                        </span>
                      ) : (
                        <>
                          {Number(l.quantity)} {l.unit} × {formatUSD(Number(l.frozen_unit_cost))}
                        </>
                      )}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {l.category}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!preview || checked.size === 0 || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {busy ? 'Adding…' : `Add ${checked.size} line${checked.size === 1 ? '' : 's'}`}
          </button>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Layers className="h-3 w-3" />
          Costs come in at the kit's resolved base rates; markup applies live from your current settings.
        </p>
      </div>

      {/* On-the-fly kit creation (reused modals stack above this one) */}
      <NewKitModal
        open={showNewKit}
        onClose={() => setShowNewKit(false)}
        onCreated={handleKitCreated}
        existingCategories={(kits ?? []).map((k) => k.category)}
        existingBranchScopes={(kits ?? [])
          .map((k) => k.branch_scope)
          .filter((s): s is string => Boolean(s))}
      />
      <AddKitLineModal
        open={showAddLine && lineRefs !== null}
        onClose={() => setShowAddLine(false)}
        onAdd={(draft) => void handleLineDraft(draft)}
        laborTypes={lineRefs?.laborTypes ?? []}
        equipmentRates={lineRefs?.equipmentRates ?? []}
        catalogItems={lineRefs?.catalogItems ?? []}
      />
    </Modal>
  )
}
