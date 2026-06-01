import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { addWorkAreaToProposal } from '@/lib/proposals'

/**
 * Small form modal for ad-hoc work areas (change orders, allowances,
 * anything not linked to a project work_area). Submits with
 * work_area_id=NULL and the form's name/description as the override
 * labels displayed in the editor.
 */
interface AddAdHocWorkAreaModalProps {
  open: boolean
  onClose: () => void
  proposalId: string
  onAdded: () => void
}

export function AddAdHocWorkAreaModal({
  open,
  onClose,
  proposalId,
  onAdded,
}: AddAdHocWorkAreaModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setSubmitting(false)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Name is required.')
      return
    }
    setSubmitting(true)
    try {
      await addWorkAreaToProposal({
        proposalId,
        workAreaId: null,
        nameOverride: trimmedName,
        descriptionOverride: description.trim() || undefined,
      })
      toast.success('Ad-hoc work area added.')
      onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add work area.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Add ad-hoc work area"
      description="Change orders, allowances, or anything not linked to a project work area."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Name <span className="ml-1 text-rose-600">*</span>
          </span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Change Order #1"
            className={inputClasses}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional context."
            className={inputClasses}
          />
        </label>
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
            disabled={submitting || !name.trim()}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add work area'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'
