import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import DecimalInput from '@/components/decimal-input/DecimalInput'
import { addCustomLine } from '@/lib/proposals'
import type { ProposalLineCategory } from '@/lib/types'

/**
 * Manual line entry modal for categories with no catalog reference —
 * Labor + Equipment. Labor lines would typically reference
 * company_labor_types and Equipment lines company_equipment_rates,
 * but Phase 2g uses freeform entry; an enhancement could let the
 * contractor pick a labor type / equipment rate slot to populate
 * label + unit cost (Phase 2h or 3 polish).
 *
 * Submit calls addCustomLine; frozen_labor_rate / frozen_equipment_rate
 * are NULL on custom lines per Phase 2c data layer.
 */

interface AddCustomLineModalProps {
  open: boolean
  onClose: () => void
  proposalWorkAreaId: string
  category: ProposalLineCategory
  onAdded: () => void
}

export function AddCustomLineModal({
  open,
  onClose,
  proposalWorkAreaId,
  category,
  onAdded,
}: AddCustomLineModalProps) {
  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState('')
  const [qty, setQty] = useState<number | null>(null)
  const [unitCost, setUnitCost] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLabel('')
    setUnit(suggestedUnit(category))
    setQty(null)
    setUnitCost(null)
    setSubmitting(false)
  }, [open, category])

  const canSubmit =
    label.trim().length > 0 &&
    unit.trim().length > 0 &&
    qty !== null &&
    Number.isFinite(qty) &&
    qty > 0 &&
    unitCost !== null &&
    Number.isFinite(unitCost) &&
    unitCost >= 0 &&
    !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await addCustomLine({
        proposalWorkAreaId,
        category,
        label: label.trim(),
        unit: unit.trim(),
        quantity: qty as number,
        unitCost: unitCost as number,
      })
      toast.success('Line added.')
      onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add line.')
      setSubmitting(false)
    }
  }

  const isLaborLike = category === 'labor' || category === 'equipment'

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={`Add custom ${LABELS[category]} line`}
      description={
        isLaborLike
          ? `${LABELS[category]} lines bill at the entered rate — no catalog reference.`
          : `Manual ${LABELS[category]} line entry.`
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Description <span className="ml-1 text-rose-600">*</span>
          </span>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              category === 'labor'
                ? 'e.g. Stone Masons'
                : category === 'equipment'
                  ? 'e.g. Mini excavator'
                  : 'Line label'
            }
            disabled={submitting}
            className={inputClasses}
            autoFocus
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Unit <span className="ml-1 text-rose-600">*</span>
            </span>
            <input
              type="text"
              required
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={isLaborLike ? 'Hr' : 'EA'}
              disabled={submitting}
              className={inputClasses}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Quantity <span className="ml-1 text-rose-600">*</span>
            </span>
            <DecimalInput
              value={qty}
              onCommit={(n) => setQty(n)}
              placeholder="0"
              className={inputClasses}
              disabled={submitting}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {isLaborLike ? 'Rate' : 'Cost'} per unit <span className="ml-1 text-rose-600">*</span>
            </span>
            <DecimalInput
              value={unitCost}
              onCommit={(n) => setUnitCost(n)}
              placeholder="0.00"
              className={inputClasses}
              disabled={submitting}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Adding…' : 'Add line'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const LABELS: Record<ProposalLineCategory, string> = {
  labor: 'labor',
  material: 'material',
  equipment: 'equipment',
  subcontractor: 'subcontractor',
  other: 'other',
}

function suggestedUnit(c: ProposalLineCategory): string {
  if (c === 'labor') return 'Hr'
  if (c === 'equipment') return 'Hr'
  return ''
}

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'
