import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import type { Customer, Project } from '@/lib/types'

type CustomerProject = Pick<Project, 'id' | 'name' | 'status' | 'created_at'>

export default function CustomerDetailPage() {
  const { id: customerId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [projects, setProjects] = useState<CustomerProject[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user || !customerId) return
    setLoading(true)
    const [{ data: cData, error: cErr }, { data: pData, error: pErr }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).maybeSingle(),
      supabase
        .from('projects')
        .select('id, name, status, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
    ])
    setLoading(false)
    if (cErr) {
      toast.error(`Couldn't load customer: ${cErr.message}`)
      return
    }
    if (!cData) {
      setNotFound(true)
      return
    }
    if (pErr) toast.error(`Couldn't load this customer's projects: ${pErr.message}`)
    setCustomer(cData as Customer)
    setProjects((pData ?? []) as CustomerProject[])
  }, [user, customerId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (changes: Partial<Customer>): Promise<boolean> => {
      if (!customer) return false
      const previous = customer
      setCustomer({ ...customer, ...changes } as Customer)
      const { data, error } = await supabase
        .from('customers')
        .update(changes)
        .eq('id', customer.id)
        .select('*')
        .single()
      if (error || !data) {
        setCustomer(previous)
        toast.error(`Save failed: ${error?.message ?? 'unknown error'}`)
        return false
      }
      setCustomer(data as Customer)
      return true
    },
    [customer]
  )

  const handleDelete = async () => {
    if (!customer) return
    const { error } = await supabase.from('customers').delete().eq('id', customer.id)
    if (error) {
      toast.error(`Delete failed: ${error.message}`)
      return
    }
    toast.success('Customer deleted. Their projects are now unassigned.')
    navigate('/app/customers')
  }

  if (loading && !customer) {
    return (
      <div className="rounded-xl border border-brand-border bg-white p-6 text-sm text-brand-text-muted">
        Loading customer…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-bold text-rose-900">Customer not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This customer doesn't exist, or belongs to a different account.
        </p>
        <Link
          to="/app/customers"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to customers
        </Link>
      </div>
    )
  }

  if (!customer) return null

  return (
    <div className="space-y-6">
      <Link
        to="/app/customers"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-text-muted hover:text-brand-navy"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to customers
      </Link>

      {/* Name as page heading. Editing handled inline via BlurSaveInput. */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <BlurSaveInput
            value={customer.name}
            onSave={async (v) => {
              const next = v.trim()
              if (!next) {
                toast.error('Customer name cannot be empty.')
                return false
              }
              return patch({ name: next })
            }}
            className="block w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-3xl font-extrabold tracking-tight text-brand-text outline-none hover:border-brand-border focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            placeholder="Customer name"
          />
          {customer.email && (
            <p className="mt-1 text-sm text-brand-text-muted">{customer.email}</p>
          )}
        </div>
        <span className="rounded-full bg-brand-surface px-3 py-1 text-xs font-semibold text-brand-text-muted">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
      </header>

      <section className="rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
          Contact information
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field label="Email">
            <BlurSaveInput
              type="email"
              value={customer.email ?? ''}
              onSave={(v) => patch({ email: v.trim() || null })}
              className={inputClasses}
              placeholder="customer@example.com"
            />
          </Field>
          <Field label="Phone">
            <BlurSaveInput
              type="tel"
              value={customer.phone ?? ''}
              onSave={(v) => patch({ phone: v.trim() || null })}
              className={inputClasses}
              placeholder="508-555-0123"
            />
          </Field>
          <Field label="Billing address" className="sm:col-span-2">
            <BlurSaveTextarea
              value={customer.billing_address ?? ''}
              onSave={(v) => patch({ billing_address: v.trim() || null })}
              rows={2}
              placeholder="Where the invoice goes"
            />
          </Field>
          <Field label="Site address" className="sm:col-span-2">
            <BlurSaveTextarea
              value={customer.site_address ?? ''}
              onSave={(v) => patch({ site_address: v.trim() || null })}
              rows={2}
              placeholder="Where the work happens"
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <BlurSaveTextarea
              value={customer.notes ?? ''}
              onSave={(v) => patch({ notes: v.trim() || null })}
              rows={4}
              placeholder="Anything worth remembering about this customer."
            />
          </Field>
        </dl>
      </section>

      <section className="rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
          Projects
        </h2>
        {projects.length === 0 ? (
          <p className="mt-3 text-sm text-brand-text-muted">
            No projects yet for this customer.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-brand-border">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/app/projects/${p.id}`}
                  className="flex items-center justify-between gap-4 px-1 py-3 hover:bg-brand-surface focus:bg-brand-surface focus:outline-none"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-brand-text">{p.name}</div>
                    <div className="text-xs text-brand-text-muted">
                      Created {formatShortDate(p.created_at)}
                    </div>
                  </div>
                  <StatusBadge kind="project" value={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
          Danger zone
        </h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-text-muted">
            Deleting this customer is permanent. Their projects stay, but their
            customer link will be cleared.
          </p>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete customer
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete this customer?"
        description={
          <>
            <strong className="text-brand-text">{customer.name}</strong> will be
            permanently deleted. Their <strong>{projects.length}</strong>{' '}
            project{projects.length === 1 ? '' : 's'} will stay but their
            customer field will be set to <em>Unassigned</em>.
          </>
        }
        confirmLabel="Delete customer"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * Inline edit helpers
 * ============================================================ */

function BlurSaveInput({
  value,
  onSave,
  type = 'text',
  placeholder,
  className,
}: {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  type?: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const handleBlur = () => {
    if (draft === value) return
    void onSave(draft)
  }
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
    />
  )
}

function BlurSaveTextarea({
  value,
  onSave,
  rows,
  placeholder,
}: {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  rows: number
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const handleBlur = () => {
    if (draft === value) return
    void onSave(draft)
  }
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      rows={rows}
      placeholder={placeholder}
      className={inputClasses}
    />
  )
}

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
