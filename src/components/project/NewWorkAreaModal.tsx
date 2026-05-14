import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { WORK_AREA_STATUS_CONFIG, WORK_AREA_STATUS_ORDER } from '@/lib/statusConfig'
import type { WorkArea, WorkAreaStatus } from '@/lib/types'

interface NewWorkAreaModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  /**
   * The sequence_order to assign. Caller passes `workAreas.length` (or
   * whatever the next slot is) so we don't have to re-query max here.
   */
  nextSequenceOrder: number
  onCreated?: (workArea: WorkArea) => void
}

export function NewWorkAreaModal({
  open,
  onClose,
  projectId,
  nextSequenceOrder,
  onCreated,
}: NewWorkAreaModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<WorkAreaStatus>('draft')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setStatus('draft')
    setSubmitting(false)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Work area name is required.')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase
      .from('work_areas')
      .insert({
        project_id: projectId,
        name: trimmedName,
        description: description.trim() || null,
        status,
        sequence_order: nextSequenceOrder,
      })
      .select()
      .single()
    setSubmitting(false)
    if (error || !data) {
      toast.error(`Could not create work area: ${error?.message ?? 'unknown error'}`)
      return
    }
    toast.success('Work area added.')
    onCreated?.(data as WorkArea)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New work area"
      description="A discrete scope of work within this project (e.g. front yard, retaining wall, planting)."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Name" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front yard retaining wall"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Brief scope summary. Detailed scope text comes from Jamie or your own notes later."
            className={inputClasses}
          />
        </FormField>

        <FormField label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as WorkAreaStatus)}
            className={inputClasses}
          >
            {WORK_AREA_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {WORK_AREA_STATUS_CONFIG[s].label}
              </option>
            ))}
          </select>
        </FormField>

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
            {submitting ? 'Adding…' : 'Add work area'}
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
