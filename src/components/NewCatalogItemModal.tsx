import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  CATALOG_CATEGORY_CONFIG,
  CATALOG_CATEGORY_ORDER,
} from '@/lib/statusConfig'
import type { CatalogCategory, CatalogItem } from '@/lib/types'

export const CATALOG_UNITS: string[] = [
  'sq ft',
  'lf',
  'each',
  'hour',
  'cy',
  'ton',
  'gal',
  'lb',
]

interface NewCatalogItemModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (item: CatalogItem) => void
}

export function NewCatalogItemModal({
  open,
  onClose,
  onCreated,
}: NewCatalogItemModalProps) {
  const { user } = useAuth()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState<string>('each')
  const [category, setCategory] = useState<CatalogCategory>('material')
  const [unitCost, setUnitCost] = useState('0')
  const [markup, setMarkup] = useState('0')
  const [active, setActive] = useState(true)
  const [needsPricing, setNeedsPricing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setUnit('each')
    setCategory('material')
    setUnitCost('0')
    setMarkup('0')
    setActive(true)
    setNeedsPricing(false)
    setSubmitting(false)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Item name is required.')
      return
    }
    const unitCostNum = parseFloat(unitCost)
    const markupNum = parseFloat(markup)
    if (Number.isNaN(unitCostNum) || unitCostNum < 0) {
      toast.error('Unit cost must be a non-negative number.')
      return
    }
    if (Number.isNaN(markupNum)) {
      toast.error('Markup percent must be a number.')
      return
    }

    setSubmitting(true)
    const { data, error } = await supabase
      .from('catalog_items')
      .insert({
        user_id: user.id,
        name: trimmedName,
        description: description.trim() || null,
        unit,
        category,
        unit_cost: unitCostNum,
        markup_percent: markupNum,
        active,
        needs_pricing: needsPricing,
      })
      .select()
      .single()
    setSubmitting(false)

    if (error || !data) {
      toast.error(`Could not create item: ${error?.message ?? 'unknown error'}`)
      return
    }
    toast.success('Catalog item created.')
    onCreated?.(data as CatalogItem)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New catalog item"
      description="Items here get pulled into proposal line items. Labor, materials, equipment, disposal — anything you bill for."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Name" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stone veneer (flat ledger)"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Spec details, brand/color, etc."
            className={inputClasses}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Unit" required>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={inputClasses}
            >
              {CATALOG_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Category" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CatalogCategory)}
              className={inputClasses}
            >
              {CATALOG_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATALOG_CATEGORY_CONFIG[c].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Unit cost" required>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-text-muted">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className={`${inputClasses} pl-7`}
              />
            </div>
          </FormField>
          <FormField label="Markup percent" required>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                required
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
                className={`${inputClasses} pr-8`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-text-muted">%</span>
            </div>
          </FormField>
        </div>

        <div className="space-y-2.5 rounded-md border border-brand-border bg-brand-surface p-3">
          <label className="flex items-center gap-2 text-sm text-brand-text">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-brand-border text-brand-navy focus:ring-brand-navy"
            />
            <span><strong className="font-semibold">Active</strong> — visible in the catalog by default</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-brand-text">
            <input
              type="checkbox"
              checked={needsPricing}
              onChange={(e) => setNeedsPricing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-brand-border text-brand-navy focus:ring-brand-navy"
            />
            <span>
              <strong className="font-semibold">Needs pricing</strong>
              <span className="text-brand-text-muted"> — flag this item if pricing should be filled in later (used by Jamie in Phase 2)</span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create item'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none transition-colors placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

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
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  )
}
