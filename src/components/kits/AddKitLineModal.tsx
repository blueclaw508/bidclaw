import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import {
  ALL_FACTOR_UNITS,
  FACTOR_UNIT_GROUPS,
} from '@/components/kits/factorUnits'
import type {
  CatalogItem,
  CompanyEquipmentRate,
  CompanyLaborType,
  KitLineReferenceType,
  KitLineType,
} from '@/lib/types'

/**
 * Draft for a new kit line. The parent (KitDetail) holds the kit's
 * local edit state — this modal collects the new line's fields and
 * hands the draft back via onAdd. Save semantics: nothing is written
 * to the DB here. The sticky Save bar on KitDetail flushes new lines
 * along with all other dirty edits.
 */
export interface NewKitLineDraft {
  type: KitLineType
  display_name: string
  reference_type: KitLineReferenceType
  reference_labor_type_id: string | null
  reference_equipment_rate_id: string | null
  reference_catalog_item_id: string | null
  factor: number | null
  factor_unit: string | null
  notes: string | null
}

interface AddKitLineModalProps {
  open: boolean
  onClose: () => void
  onAdd: (draft: NewKitLineDraft) => void
  /** Pre-loaded reference options — keeps the modal a pure form. */
  laborTypes: Pick<CompanyLaborType, 'id' | 'name' | 'rate_per_hour' | 'slot_number'>[]
  equipmentRates: Pick<
    CompanyEquipmentRate,
    'id' | 'name' | 'rate_per_hour' | 'slot_number'
  >[]
  catalogItems: Pick<CatalogItem, 'id' | 'name' | 'category' | 'unit' | 'unit_cost'>[]
  /** Existing factor units in this kit, for the datalist suggestions. */
  existingFactorUnits?: string[]
}

const TYPE_OPTIONS: { value: KitLineType; label: string }[] = [
  { value: 'Labor', label: 'Labor' },
  { value: 'Material', label: 'Material' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Sub', label: 'Sub' },
  { value: 'Other', label: 'Other' },
]

// Factor unit suggestions live in `@/components/kits/factorUnits`. We
// render them as <optgroup> blocks inside the datalist so the contractor
// can scan by kit-input-unit family. Kit-specific units the contractor
// already entered get merged into an "In this kit" group at the top.

export function AddKitLineModal({
  open,
  onClose,
  onAdd,
  laborTypes,
  equipmentRates,
  catalogItems,
  existingFactorUnits = [],
}: AddKitLineModalProps) {
  const [type, setType] = useState<KitLineType>('Material')
  const [displayName, setDisplayName] = useState('')
  const [referenceId, setReferenceId] = useState<string>('') // '' = no reference
  const [factor, setFactor] = useState('')
  const [factorUnit, setFactorUnit] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setType('Material')
    setDisplayName('')
    setReferenceId('')
    setFactor('')
    setFactorUnit('')
    setNotes('')
  }, [open])

  // Filter named-only slots for labor/equipment (un-configured slots
  // shouldn't show as pickable references).
  const namedLaborTypes = useMemo(
    () => laborTypes.filter((l) => l.name && l.name.trim().length > 0),
    [laborTypes]
  )
  const namedEquipmentRates = useMemo(
    () => equipmentRates.filter((e) => e.name && e.name.trim().length > 0),
    [equipmentRates]
  )
  // For Material kit_lines, only show catalog items whose internal
  // category is 'material'. The DB CHECK enforces FK/reference_type
  // consistency but NOT catalog-category alignment, so without this
  // filter a contractor's catalog item with category='equipment' (e.g.
  // "Cement Mixer") would surface alongside true materials. UX fix only —
  // no data-layer change so other callers stay unaffected.
  const materialCatalogItems = useMemo(
    () => catalogItems.filter((c) => c.category === 'material'),
    [catalogItems]
  )

  // Which reference dropdown applies to the current type
  const showReferenceDropdown =
    type === 'Labor' || type === 'Material' || type === 'Equipment'

  // Any kit-specific units the contractor already entered that aren't
  // in the shared groups — promoted to the top of the dropdown so
  // they're discoverable on this kit even when they don't match the
  // standard taxonomy.
  const customUnits = useMemo(() => {
    const standard = new Set(ALL_FACTOR_UNITS)
    const seen = new Set<string>()
    const out: string[] = []
    for (const u of existingFactorUnits) {
      if (!u) continue
      if (standard.has(u)) continue
      if (seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
    return out.sort()
  }, [existingFactorUnits])

  // When type changes, reset the reference selection — different types
  // pull from different lookup tables.
  const handleTypeChange = (next: KitLineType) => {
    setType(next)
    setReferenceId('')
  }

  // When a reference is picked, auto-fill the display name from the
  // upstream entity (unless the user has already typed something).
  const handleReferenceChange = (id: string) => {
    setReferenceId(id)
    if (id && !displayName.trim()) {
      const found =
        type === 'Labor'
          ? namedLaborTypes.find((l) => l.id === id)
          : type === 'Equipment'
            ? namedEquipmentRates.find((e) => e.id === id)
            : materialCatalogItems.find((c) => c.id === id)
      if (found) setDisplayName(found.name ?? '')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = displayName.trim()
    const trimmedFactorUnit = factorUnit.trim()
    if (!trimmedName) {
      toast.error('Display name is required.')
      return
    }
    // Factor is optional (placeholder lines have NULL factor). If
    // provided, validate as non-negative number.
    let parsedFactor: number | null = null
    if (factor.trim().length > 0) {
      const n = Number(factor)
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Factor must be a non-negative number.')
        return
      }
      parsedFactor = n
    }
    // If factor is set, factor_unit is recommended (but not enforced
    // here — the DB allows NULL unit). Surface a soft warning.
    if (parsedFactor !== null && !trimmedFactorUnit) {
      toast.error('Factor unit is required when factor is set.')
      return
    }

    // Build the reference triple based on type + picked id
    let reference_type: KitLineReferenceType = 'none'
    let reference_labor_type_id: string | null = null
    let reference_equipment_rate_id: string | null = null
    let reference_catalog_item_id: string | null = null
    if (referenceId && showReferenceDropdown) {
      switch (type) {
        case 'Labor':
          reference_type = 'labor_type'
          reference_labor_type_id = referenceId
          break
        case 'Equipment':
          reference_type = 'equipment_rate'
          reference_equipment_rate_id = referenceId
          break
        case 'Material':
          reference_type = 'catalog_item'
          reference_catalog_item_id = referenceId
          break
      }
    }

    onAdd({
      type,
      display_name: trimmedName,
      reference_type,
      reference_labor_type_id,
      reference_equipment_rate_id,
      reference_catalog_item_id,
      factor: parsedFactor,
      factor_unit: trimmedFactorUnit || null,
      notes: notes.trim() || null,
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add line"
      description="The factor × kit input quantity will become this line's proposal quantity."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Type" required>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as KitLineType)}
              className={inputClasses}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          {showReferenceDropdown ? (
            <FormField label="Reference">
              <select
                value={referenceId}
                onChange={(e) => handleReferenceChange(e.target.value)}
                className={inputClasses}
              >
                <option value="">(no reference / placeholder)</option>
                {type === 'Labor' &&
                  namedLaborTypes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.rate_per_hour != null
                        ? ` — $${l.rate_per_hour}/hr`
                        : ''}
                    </option>
                  ))}
                {type === 'Equipment' &&
                  namedEquipmentRates.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.rate_per_hour != null
                        ? ` — $${e.rate_per_hour}/hr`
                        : ''}
                    </option>
                  ))}
                {type === 'Material' &&
                  materialCatalogItems.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.unit})
                    </option>
                  ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Reference">
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-xs italic text-gray-500">
                {type} lines don't link to a settings entity. Add display
                name + factor below.
              </div>
            </FormField>
          )}
        </div>

        <FormField label="Display name" required>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Stone Masons or Stone Veneer"
            className={inputClasses}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Factor">
            <input
              type="text"
              inputMode="decimal"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              placeholder="e.g. 0.22"
              className={inputClasses}
            />
            <p className="mt-1 text-xs text-gray-500">
              Decimal. Multiplied by kit input quantity.
            </p>
          </FormField>
          <FormField label="Factor unit">
            <input
              type="text"
              list="kit-line-factor-units"
              value={factorUnit}
              onChange={(e) => setFactorUnit(e.target.value)}
              placeholder="Hr/SF"
              className={inputClasses}
            />
            <datalist id="kit-line-factor-units">
              {customUnits.length > 0 && (
                <optgroup label="In this kit">
                  {customUnits.map((u) => (
                    <option key={`custom-${u}`} value={u} />
                  ))}
                </optgroup>
              )}
              {FACTOR_UNIT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.units.map((u) => (
                    <option key={`${g.label}-${u}`} value={u} />
                  ))}
                </optgroup>
              ))}
            </datalist>
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional — any per-line context for Jamie or the crew."
            className={inputClasses}
          />
        </FormField>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!displayName.trim()}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            Add line
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------- shared ---------- */

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  )
}
