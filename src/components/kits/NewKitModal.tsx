import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { createKit } from '@/lib/kits'
import type { Kit } from '@/lib/types'

/**
 * Modal for creating a new kit. Collects the four required fields
 * (name, category, input unit, branch scope) plus optional Jamie
 * notes. On save: persists, calls onCreated, closes. Callers
 * typically navigate to /app/kits/<new id> to start adding lines.
 *
 * Suggestion dropdowns: existing categories + branch scopes from the
 * contractor's other kits are passed in via props. Input unit
 * suggestions are a static common-units list since they're stable
 * across trades (SF, LF, CY, EA, ...).
 */
interface NewKitModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (kit: Kit) => void
  /** Existing categories used in the contractor's kits — for suggestions. */
  existingCategories?: string[]
  /** Existing branch scopes — for suggestions. */
  existingBranchScopes?: string[]
}

const UNIT_SUGGESTIONS = ['SF', 'LF', 'CY', 'EA', 'SqFt', 'CuYd', '1FT', 'TON', 'HR']
const DEFAULT_BRANCH_SCOPE = 'All Branches'

export function NewKitModal({
  open,
  onClose,
  onCreated,
  existingCategories = [],
  existingBranchScopes = [],
}: NewKitModalProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [inputUnit, setInputUnit] = useState('')
  const [branchScope, setBranchScope] = useState(DEFAULT_BRANCH_SCOPE)
  const [jamieNotes, setJamieNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset whenever the modal opens fresh so reopening doesn't show
  // stale state from a prior cancelled attempt.
  useEffect(() => {
    if (!open) return
    setName('')
    setCategory('')
    setInputUnit('')
    setBranchScope(DEFAULT_BRANCH_SCOPE)
    setJamieNotes('')
    setSubmitting(false)
  }, [open])

  // De-dupe + alphabetize suggestion lists, with the default
  // branch scope always available even when no kits exist yet.
  const categoryOptions = useMemo(() => {
    return Array.from(new Set(existingCategories.filter(Boolean))).sort()
  }, [existingCategories])

  const branchScopeOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_BRANCH_SCOPE])
    for (const s of existingBranchScopes) if (s) set.add(s)
    return Array.from(set).sort()
  }, [existingBranchScopes])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedCategory = category.trim()
    const trimmedUnit = inputUnit.trim()
    if (!trimmedName) {
      toast.error('Kit name is required.')
      return
    }
    if (!trimmedCategory) {
      toast.error('Category is required.')
      return
    }
    if (!trimmedUnit) {
      toast.error('Input unit is required.')
      return
    }
    setSubmitting(true)
    try {
      const kit = await createKit({
        name: trimmedName,
        category: trimmedCategory,
        input_unit: trimmedUnit,
        branch_scope: branchScope.trim() || null,
        jamie_notes: jamieNotes.trim() || null,
      })
      toast.success('Kit created. Add line items next.')
      onCreated?.(kit)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create kit.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New kit"
      description="A kit is a recipe for a work type. Header now, line items next."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Kit name" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Drylaid Bluestone Patio — Standard"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Category" required>
            <input
              type="text"
              required
              list="kit-category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Paver"
              className={inputClasses}
            />
            <datalist id="kit-category-suggestions">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Input unit" required>
            <input
              type="text"
              required
              list="kit-unit-suggestions"
              value={inputUnit}
              onChange={(e) => setInputUnit(e.target.value)}
              placeholder="SF"
              className={inputClasses}
            />
            <datalist id="kit-unit-suggestions">
              {UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </FormField>
        </div>

        <FormField label="Branch scope">
          <input
            type="text"
            list="kit-branch-suggestions"
            value={branchScope}
            onChange={(e) => setBranchScope(e.target.value)}
            placeholder="All Branches"
            className={inputClasses}
          />
          <datalist id="kit-branch-suggestions">
            {branchScopeOptions.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Jamie notes">
          <textarea
            value={jamieNotes}
            onChange={(e) => setJamieNotes(e.target.value)}
            rows={3}
            placeholder="Anything Jamie should know when picking this kit — typical use cases, gotchas, when to choose this vs a sibling kit."
            className={inputClasses}
          />
        </FormField>

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
            disabled={
              submitting ||
              !name.trim() ||
              !category.trim() ||
              !inputUnit.trim()
            }
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create kit'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------- shared styles ---------- */

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
