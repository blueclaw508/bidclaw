import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { convertLeadToProject } from '@/lib/leads'
import type { Customer, Lead } from '@/lib/types'

type CustomerMode = 'create' | 'existing' | 'none'

interface ConvertLeadModalProps {
  open: boolean
  onClose: () => void
  lead: Lead
  /** Called after a successful conversion with the updated lead. */
  onConverted?: (lead: Lead) => void
}

/**
 * Convert a lead → project (→ Estimating). Default path creates a
 * customer from the lead's contact so the project is fully wired in
 * one step; Ian can also link an existing customer or skip.
 */
export function ConvertLeadModal({ open, onClose, lead, onConverted }: ConvertLeadModalProps) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [projectName, setProjectName] = useState('')
  const [customerMode, setCustomerMode] = useState<CustomerMode>('create')
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [existingCustomerId, setExistingCustomerId] = useState('')
  const [goToProject, setGoToProject] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Reset + prefill on open
  useEffect(() => {
    if (!open) return
    const suggested = [lead.name, lead.town].filter(Boolean).join(' — ')
    setProjectName(suggested)
    setCustomerMode('create')
    setExistingCustomerId('')
    setGoToProject(true)
    setSubmitting(false)
  }, [open, lead])

  // Customer list only needed for 'existing' mode — fetch lazily once
  useEffect(() => {
    if (!open || customerMode !== 'existing' || customers !== null) return
    void (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name')
      if (error) {
        toast.error(`Couldn't load customers: ${error.message}`)
        return
      }
      setCustomers((data ?? []) as Customer[])
    })()
  }, [open, customerMode, customers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!projectName.trim()) {
      toast.error('Project name is required.')
      return
    }
    if (customerMode === 'existing' && !existingCustomerId) {
      toast.error('Pick a customer to link.')
      return
    }
    setSubmitting(true)
    try {
      const result = await convertLeadToProject({
        lead,
        userId: user.id,
        projectName,
        customerMode,
        existingCustomerId: existingCustomerId || undefined,
      })
      toast.success('Lead converted — project is in Estimating.')
      onConverted?.(result.lead)
      onClose()
      if (goToProject) navigate(`/app/projects/${result.projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Conversion failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Convert to project"
      description="Creates the project in Estimating and links it to this lead."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            Project name<span className="ml-1 text-rose-600">*</span>
          </span>
          <input
            type="text"
            required
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className={inputClasses}
            autoFocus
          />
        </label>

        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            Customer
          </legend>
          <div className="space-y-2">
            <RadioRow
              checked={customerMode === 'create'}
              onChange={() => setCustomerMode('create')}
              label={`Create customer from this lead (${lead.name})`}
            />
            <RadioRow
              checked={customerMode === 'existing'}
              onChange={() => setCustomerMode('existing')}
              label="Link an existing customer"
            />
            {customerMode === 'existing' && (
              <select
                value={existingCustomerId}
                onChange={(e) => setExistingCustomerId(e.target.value)}
                className={inputClasses}
              >
                <option value="">
                  {customers === null ? 'Loading customers…' : 'Pick a customer…'}
                </option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <RadioRow
              checked={customerMode === 'none'}
              onChange={() => setCustomerMode('none')}
              label="No customer yet — assign later"
            />
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-brand-text-muted">
          <input
            type="checkbox"
            checked={goToProject}
            onChange={(e) => setGoToProject(e.target.checked)}
            className="h-4 w-4 rounded border-brand-border text-brand-navy focus:ring-brand-navy"
          />
          Open the project after converting
        </label>

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
            disabled={submitting || !projectName.trim()}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitting ? 'Converting…' : 'Convert to project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none transition-colors placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function RadioRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-brand-text">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 border-brand-border text-brand-navy focus:ring-brand-navy"
      />
      {label}
    </label>
  )
}
