import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/EmptyState'
import { NewCustomerModal } from '@/components/NewCustomerModal'
import type { Customer } from '@/lib/types'

type CustomerRow = Customer & {
  projects: { id: string }[]
}

export default function CustomersPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<CustomerRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoadError(null)
    const { data, error } = await supabase
      .from('customers')
      .select('*, projects(id)')
      .eq('user_id', user.id)
    if (error) {
      setLoadError(error.message)
      setRows([])
      return
    }
    setRows((data ?? []) as CustomerRow[])
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    const r = q
      ? rows.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.email ?? '').toLowerCase().includes(q)
        )
      : rows
    return [...r].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, search])

  const totalCount = rows?.length ?? 0
  const hasNone = totalCount === 0

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
            Customers
          </h1>
          <p className="mt-1 text-sm text-brand-text-muted">
            Your contact list. Linked to every project they own.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-2 self-start rounded-md bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          New customer
        </button>
      </header>

      {!hasNone && (
        <label className="relative block w-full sm:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" />
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-brand-border bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
          />
        </label>
      )}

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load customers: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-brand-border bg-white p-6 text-sm text-brand-text-muted">
          Loading customers…
        </div>
      )}

      {!loadError && rows && hasNone && (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Add a customer to attach them to a project. You can also create customers on the fly from any project."
          ctaLabel="Add customer"
          onCta={() => setNewOpen(true)}
        />
      )}

      {!loadError && rows && !hasNone && visible && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-brand-border bg-white p-10 text-center text-sm text-brand-text-muted">
          No customers match your search.
        </div>
      )}

      {!loadError && rows && !hasNone && visible && visible.length > 0 && (
        <CustomerList rows={visible} />
      )}

      <NewCustomerModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  )
}

/* ============================================================
 * CustomerList — table on desktop, stacked cards on mobile
 * ============================================================ */

function CustomerList({ rows }: { rows: CustomerRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-sm">
      <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_1fr_80px_120px] gap-4 border-b border-brand-border bg-brand-surface px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-text-muted lg:grid">
        <div>Name</div>
        <div>Email</div>
        <div>Phone</div>
        <div>Site address</div>
        <div>Projects</div>
        <div>Updated</div>
      </div>

      <ul className="divide-y divide-brand-border">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              to={`/app/customers/${c.id}`}
              className="block transition-colors hover:bg-brand-surface focus:bg-brand-surface focus:outline-none"
            >
              {/* Desktop */}
              <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_1fr_80px_120px] items-center gap-4 px-5 py-4 lg:grid">
                <div className="truncate text-sm font-semibold text-brand-text">{c.name}</div>
                <div className="truncate text-sm text-brand-text-muted">
                  {c.email ?? <span className="italic">—</span>}
                </div>
                <div className="truncate text-sm text-brand-text-muted">
                  {c.phone ?? <span className="italic">—</span>}
                </div>
                <div className="truncate text-sm text-brand-text-muted">
                  {c.site_address ?? <span className="italic">—</span>}
                </div>
                <div className="text-sm text-brand-text">{c.projects.length}</div>
                <div className="text-sm text-brand-text-muted">{formatShortDate(c.updated_at)}</div>
              </div>

              {/* Mobile */}
              <div className="flex flex-col gap-1 px-4 py-4 lg:hidden">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-sm font-semibold text-brand-text">{c.name}</div>
                  <span className="shrink-0 rounded-full bg-brand-surface px-2 py-0.5 text-xs font-semibold text-brand-text-muted">
                    {c.projects.length} project{c.projects.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="text-xs text-brand-text-muted">
                  {c.email ?? ''}
                  {c.email && c.phone ? ' · ' : ''}
                  {c.phone ?? ''}
                </div>
                {c.site_address && (
                  <div className="truncate text-xs text-brand-text-muted">{c.site_address}</div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
