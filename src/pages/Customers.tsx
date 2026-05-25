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
    <div className="space-y-6 pb-8">
      {/* Gradient page header — QC blue */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Customers</h1>
              <p className="text-blue-100 text-sm mt-0.5">
                Your contact list. Linked to every project they own.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            New customer
          </button>
        </div>
      </div>

      {!hasNone && (
        <label className="relative block w-full sm:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
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
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
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
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
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
 * CustomerList — one big QC-style card with slate-50 header
 * ============================================================ */

function CustomerList({ rows }: { rows: CustomerRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_1fr_80px_120px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div>Name</div>
        <div>Email</div>
        <div>Phone</div>
        <div>Site address</div>
        <div>Projects</div>
        <div>Updated</div>
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              to={`/app/customers/${c.id}`}
              className="block transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              {/* Desktop */}
              <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_1fr_80px_120px] items-center gap-4 px-6 py-4 lg:grid">
                <div className="truncate text-sm font-semibold text-gray-900">{c.name}</div>
                <div className="truncate text-sm text-gray-600">
                  {c.email ?? <span className="italic text-gray-400">—</span>}
                </div>
                <div className="truncate text-sm text-gray-600">
                  {c.phone ?? <span className="italic text-gray-400">—</span>}
                </div>
                <div className="truncate text-sm text-gray-600">
                  {c.site_address ?? <span className="italic text-gray-400">—</span>}
                </div>
                <div className="text-sm text-gray-900">{c.projects.length}</div>
                <div className="text-sm text-gray-500">{formatShortDate(c.updated_at)}</div>
              </div>

              {/* Mobile */}
              <div className="flex flex-col gap-1 px-4 py-4 lg:hidden">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-sm font-semibold text-gray-900">{c.name}</div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {c.projects.length} project{c.projects.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {c.email ?? ''}
                  {c.email && c.phone ? ' · ' : ''}
                  {c.phone ?? ''}
                </div>
                {c.site_address && (
                  <div className="truncate text-xs text-gray-500">{c.site_address}</div>
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
