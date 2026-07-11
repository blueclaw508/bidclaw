import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { createLead } from '@/lib/leads'
import { LEAD_REGION_CONFIG, LEAD_REGION_ORDER } from '@/lib/statusConfig'
import type { Lead } from '@/lib/types'

interface NewLeadModalProps {
  open: boolean
  onClose: () => void
  /** Called after a successful create with the new lead row. */
  onCreated?: (lead: Lead) => void
}

export function NewLeadModal({ open, onClose, onCreated }: NewLeadModalProps) {
  const { user } = useAuth()

  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [region, setRegion] = useState('')
  const [estValue, setEstValue] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jobAddress, setJobAddress] = useState('')
  const [town, setTown] = useState('')
  const [source, setSource] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form whenever the modal opens fresh
  useEffect(() => {
    if (!open) return
    setProjectName('')
    setDescription('')
    setRegion('')
    setEstValue('')
    setName('')
    setPhone('')
    setEmail('')
    setJobAddress('')
    setTown('')
    setSource('')
    setFollowUpDate('')
    setSubmitting(false)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const trimmedProject = projectName.trim()
    const trimmedName = name.trim()
    // Dashboard parity (0024): a lead is project-first — it needs a
    // project name OR a contact ("? - Nantucket" rows are real).
    if (!trimmedProject && !trimmedName) {
      toast.error('Give the lead a project name or a contact name.')
      return
    }
    const value = estValue.trim() === '' ? null : Number(estValue)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error('Guess value must be a positive number.')
      return
    }
    const trimmedEmail = email.trim()
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      toast.error('Email format looks off.')
      return
    }
    setSubmitting(true)
    try {
      const lead = await createLead({
        userId: user.id,
        name: trimmedName || null,
        project_name: trimmedProject || null,
        description,
        region,
        est_value: value,
        phone,
        email: trimmedEmail,
        job_address: jobAddress,
        town,
        source,
        follow_up_date: followUpDate || null,
      })
      toast.success('Lead added.')
      onCreated?.(lead)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create lead.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New lead"
      description="The front door — every job starts here and moves through the pipeline."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Project name" required>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Concannon — Mashpee backyard"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Description">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Plunge pool, new construction, enhancement…"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Region">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className={inputClasses}
            >
              <option value="">—</option>
              {LEAD_REGION_ORDER.map((r) => (
                <option key={r} value={r}>
                  {LEAD_REGION_CONFIG[r].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Guess value ($)">
            <input
              type="number"
              min="0"
              step="any"
              value={estValue}
              onChange={(e) => setEstValue(e.target.value)}
              placeholder="15000"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Contact name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Robert Smith (leave blank if unknown)"
              className={inputClasses}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="508-555-0123"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="lead@example.com"
              className={inputClasses}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Job address">
            <input
              type="text"
              value={jobAddress}
              onChange={(e) => setJobAddress(e.target.value)}
              placeholder="Street address of the work"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Town">
            <input
              type="text"
              value={town}
              onChange={(e) => setTown(e.target.value)}
              placeholder="e.g. Duxbury"
              className={inputClasses}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Source">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Referral, website, drive-by…"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Follow-up date">
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className={inputClasses}
            />
          </FormField>
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
            disabled={submitting || (!name.trim() && !projectName.trim())}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------- shared input styling + helpers ---------- */

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none transition-colors placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-brand-surface disabled:text-brand-text-muted'

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

// Light-touch email validator — not strict RFC, just a sanity check.
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}
