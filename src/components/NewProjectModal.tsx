import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { NewCustomerModal } from '@/components/NewCustomerModal'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { AddressFields } from '@/components/AddressFields'
import type { SplitAddress } from '@/lib/address'
import { PROJECT_STATUS_CONFIG, PROJECT_STATUS_ORDER } from '@/lib/statusConfig'
import type { Customer, Project, ProjectStatus } from '@/lib/types'

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
  /** Called after a successful create (the new project is also navigated to). */
  onCreated?: (project: Project) => void
}

const EMPTY_ADDR: SplitAddress = { line1: '', city: '', state: '', zip: '' }

export function NewProjectModal({ open, onClose, onCreated }: NewProjectModalProps) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [status, setStatus] = useState<ProjectStatus>('draft')
  const [site, setSite] = useState<SplitAddress>(EMPTY_ADDR)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [customers, setCustomers] = useState<
    Pick<
      Customer,
      | 'id'
      | 'name'
      | 'site_address'
      | 'site_address_line1'
      | 'site_address_city'
      | 'site_address_state'
      | 'site_address_zip'
    >[]
  >([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)

  // Reset form whenever the modal opens fresh
  useEffect(() => {
    if (!open) return
    setName('')
    setCustomerId('')
    setStatus('draft')
    setSite(EMPTY_ADDR)
    setNotes('')
    setSubmitting(false)
  }, [open])

  // Customer loader, callable both on initial open and after inline-create
  const loadCustomers = useCallback(async () => {
    if (!user) return
    setCustomersLoading(true)
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, site_address, site_address_line1, site_address_city, site_address_state, site_address_zip')
      .eq('user_id', user.id)
      .order('name', { ascending: true })
    if (error) toast.error('Could not load customers.')
    else setCustomers(data ?? [])
    setCustomersLoading(false)
  }, [user])

  useEffect(() => {
    if (!open) return
    void loadCustomers()
  }, [open, loadCustomers])

  /**
   * R5 — prefill the job address from the selected customer's site
   * address (split fields; legacy freeform lands in Street as a
   * fallback). Editable after — projects can differ from the
   * customer's default site.
   */
  useEffect(() => {
    if (!customerId) return
    const c = customers.find((x) => x.id === customerId)
    if (!c) return
    if (
      c.site_address_line1 ||
      c.site_address_city ||
      c.site_address_state ||
      c.site_address_zip
    ) {
      setSite({
        line1: c.site_address_line1 ?? '',
        city: c.site_address_city ?? '',
        state: c.site_address_state ?? '',
        zip: c.site_address_zip ?? '',
      })
    } else if (c.site_address?.trim()) {
      setSite({ line1: c.site_address.trim(), city: '', state: '', zip: '' })
    }
  }, [customerId, customers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Project name is required.')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        customer_id: customerId || null,
        name: trimmedName,
        status,
        site_address_line1: site.line1?.trim() || null,
        site_address_city: site.city?.trim() || null,
        site_address_state: site.state?.trim() || null,
        site_address_zip: site.zip?.trim() || null,
        notes: notes.trim() || null,
      })
      .select()
      .single()
    setSubmitting(false)

    if (error || !data) {
      toast.error(`Could not create project: ${error?.message ?? 'unknown error'}`)
      return
    }
    toast.success('Project created.')
    onCreated?.(data as Project)
    onClose()
    navigate(`/app/projects/${data.id}`)
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New project"
      description="Estimates, work areas, and files attach to this project."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Project name" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 14 Bayberry Ln — front yard"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Customer">
            <div className="flex gap-2">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className={`${inputClasses} flex-1`}
                disabled={customersLoading}
              >
                <option value="">
                  {customersLoading ? 'Loading…' : 'Unassigned'}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                title="Create new customer"
                className="inline-flex items-center gap-1 rounded-md border border-brand-border bg-white px-3 py-2 text-xs font-semibold text-brand-text hover:bg-brand-surface"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </FormField>

          <FormField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className={inputClasses}
            >
              {PROJECT_STATUS_ORDER.filter((s) => s !== 'archived').map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Site address">
          <AddressFields
            idPrefix="proj-site"
            value={site}
            onChange={(f, v) => setSite((prev) => ({ ...prev, [f]: v }))}
            disabled={submitting}
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Prefills from the customer's site address — edit freely if this
            project is somewhere else.
          </p>
        </FormField>

        <FormField label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth remembering about this project."
            className={inputClasses}
          />
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
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>

      {/* Stacked inline create — sibling modal, later in source so it
          renders on top of the outer NewProjectModal. */}
      <NewCustomerModal
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        onCreated={(c) => {
          // Optimistically include + select the just-created customer.
          // Full row kept so the R5 job-address prefill sees its site
          // address immediately.
          setCustomers((prev) =>
            [...prev, c].sort((a, b) => a.name.localeCompare(b.name))
          )
          setCustomerId(c.id)
        }}
      />
    </Modal>
  )
}

/* ---------- inline form-field helper ---------- */

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
