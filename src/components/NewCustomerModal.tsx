import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Customer } from '@/lib/types'

interface NewCustomerModalProps {
  open: boolean
  onClose: () => void
  /**
   * Called after a successful create. Receives the new customer row.
   * Callers typically use this to immediately assign the new customer
   * to whatever context they're in (e.g. a project's customer_id).
   */
  onCreated?: (customer: Customer) => void
}

export function NewCustomerModal({ open, onClose, onCreated }: NewCustomerModalProps) {
  const { user } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [sameAsBilling, setSameAsBilling] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form whenever the modal opens fresh
  useEffect(() => {
    if (!open) return
    setName('')
    setEmail('')
    setPhone('')
    setBillingAddress('')
    setSiteAddress('')
    setSameAsBilling(false)
    setNotes('')
    setSubmitting(false)
  }, [open])

  // Mirror billing → site when the checkbox is on. We keep this as a
  // one-way mirror (typing in billing copies to site only while checked).
  useEffect(() => {
    if (sameAsBilling) setSiteAddress(billingAddress)
  }, [sameAsBilling, billingAddress])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Customer name is required.')
      return
    }
    const trimmedEmail = email.trim()
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      toast.error('Email format looks off.')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase
      .from('customers')
      .insert({
        user_id: user.id,
        name: trimmedName,
        email: trimmedEmail || null,
        phone: phone.trim() || null,
        billing_address: billingAddress.trim() || null,
        site_address: siteAddress.trim() || null,
        notes: notes.trim() || null,
      })
      .select()
      .single()
    setSubmitting(false)

    if (error || !data) {
      toast.error(`Could not create customer: ${error?.message ?? 'unknown error'}`)
      return
    }
    toast.success('Customer created.')
    onCreated?.(data as Customer)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="New customer"
      description="Linked to projects via the customer dropdown on each project."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Customer name" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Robert Smith / Smith Residence"
            className={inputClasses}
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="508-555-0123"
              className={inputClasses}
            />
          </FormField>
        </div>

        <FormField label="Billing address">
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            rows={2}
            placeholder="Where the invoice goes"
            className={inputClasses}
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm text-brand-text-muted">
          <input
            type="checkbox"
            checked={sameAsBilling}
            onChange={(e) => setSameAsBilling(e.target.checked)}
            className="h-4 w-4 rounded border-brand-border text-brand-navy focus:ring-brand-navy"
          />
          Site address same as billing
        </label>

        <FormField label="Site address">
          <textarea
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            rows={2}
            placeholder="Where the work happens"
            className={inputClasses}
            disabled={sameAsBilling}
          />
        </FormField>

        <FormField label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth remembering about this customer."
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
            {submitting ? 'Creating…' : 'Create customer'}
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
