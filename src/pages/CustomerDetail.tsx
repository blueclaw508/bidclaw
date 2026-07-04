import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Database,
  ClipboardList,
  ShieldAlert,
  Trash2,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AddressFields } from '@/components/AddressFields'
import { hasSplitAddress, type SplitAddress } from '@/lib/address'
import { StatusBadge } from '@/components/StatusBadge'
import { BlurSaveInput, BlurSaveTextarea } from '@/components/InlineEdit'
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
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
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
    <div className="space-y-6 pb-8">
      <Link
        to="/app/customers"
        className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to customers
      </Link>

      {/* Gradient page header — QC blue. Editable name inline via
          BlurSaveInput on white-translucent input over the gradient. */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="bg-white/20 p-2 rounded-lg shrink-0">
              <UserIcon className="w-6 h-6" />
            </div>
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
                className="block w-full rounded-md border border-white/40 bg-white/10 px-2 py-1 text-2xl font-bold text-white outline-none placeholder:text-blue-100 hover:bg-white/15 focus:bg-white/20 focus:border-white/60"
                placeholder="Customer name"
              />
              {customer.email && (
                <p className="mt-1 truncate text-blue-100 text-sm">{customer.email}</p>
              )}
            </div>
          </div>
          <span className="shrink-0 self-start rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Contact information — indigo pastel section card */}
      <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
            <UserIcon className="h-4 w-4 text-indigo-600" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-indigo-900">
            Contact information
          </h2>
        </header>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
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
            <AddressFields
              idPrefix="cd-billing"
              value={{
                line1: customer.billing_address_line1,
                city: customer.billing_address_city,
                state: customer.billing_address_state,
                zip: customer.billing_address_zip,
              }}
              onChange={(f, v) =>
                setCustomer((prev) =>
                  prev ? { ...prev, [`billing_address_${f}`]: v } : prev
                )
              }
              onFieldBlur={(f, v) =>
                void patch({ [`billing_address_${f}`]: v.trim() || null })
              }
            />
            {legacyHint(customer.billing_address, {
              line1: customer.billing_address_line1,
              city: customer.billing_address_city,
              state: customer.billing_address_state,
              zip: customer.billing_address_zip,
            })}
          </Field>
          <Field label="Site address" className="sm:col-span-2">
            <AddressFields
              idPrefix="cd-site"
              value={{
                line1: customer.site_address_line1,
                city: customer.site_address_city,
                state: customer.site_address_state,
                zip: customer.site_address_zip,
              }}
              onChange={(f, v) =>
                setCustomer((prev) =>
                  prev ? { ...prev, [`site_address_${f}`]: v } : prev
                )
              }
              onFieldBlur={(f, v) =>
                void patch({ [`site_address_${f}`]: v.trim() || null })
              }
            />
            {legacyHint(customer.site_address, {
              line1: customer.site_address_line1,
              city: customer.site_address_city,
              state: customer.site_address_state,
              zip: customer.site_address_zip,
            })}
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

      {/* Projects list — slate pastel section card */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
            <ClipboardList className="h-4 w-4 text-slate-700" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Projects
          </h2>
        </header>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-500">
            No projects yet for this customer.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/app/projects/${p.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                    <div className="text-xs text-gray-500">
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

      {/* Stats summary — gray pastel card */}
      <section className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-200">
            <Database className="h-4 w-4 text-gray-700" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
            Customer ID
          </h2>
        </header>
        <code className="block break-all rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-600">
          {customer.id}
        </code>
      </section>

      {/* Danger zone — rose pastel section card */}
      <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/60 to-white p-6 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-rose-900">
            Danger zone
          </h2>
        </header>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-rose-900/80">
            Deleting this customer is permanent. Their projects stay, but their
            customer link will be cleared.
          </p>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
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
 * Inline edit helpers — shared in @/components/InlineEdit
 * ============================================================ */

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

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
      <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
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

/**
 * Pre-R5 customers carry freeform addresses in the dormant legacy
 * columns. Show them as a hint until re-entered in the split fields.
 */
function legacyHint(legacy: string | null, split: SplitAddress) {
  if (!legacy?.trim() || hasSplitAddress(split)) return null
  return (
    <p className="mt-1.5 text-xs text-amber-700">
      Address on file (old format): "{legacy}" — re-enter it in the fields
      above and it will carry to proposals.
    </p>
  )
}
