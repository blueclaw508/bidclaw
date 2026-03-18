import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type { Estimate, EstimateStatus } from '@/lib/types'
import { PlusCircle, Search, FileText, Clock, CheckCircle2, Send, MoreVertical, Trash2, Copy } from 'lucide-react'

interface DashboardProps {
  onNewEstimate: () => void
  onOpenEstimate: (id: string) => void
}

const statusConfig: Record<EstimateStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', color: 'bg-yellow-100 text-yellow-800', icon: <Clock size={14} /> },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: <CheckCircle2 size={14} /> },
  sent_to_quickcalc: { label: 'Sent to QuickCalc', color: 'bg-blue-100 text-blue-800', icon: <Send size={14} /> },
}

export function Dashboard({ onNewEstimate, onOpenEstimate }: DashboardProps) {
  const { company } = useAuth()
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EstimateStatus | 'all'>('all')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const deleteEstimate = async (id: string) => {
    await supabase.from('estimates').delete().eq('id', id)
    setEstimates((prev) => prev.filter((e) => e.id !== id))
    setConfirmDelete(null)
    setMenuOpen(null)
    toast.success('Estimate deleted')
  }

  // Escape key closes menus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(null)
        setConfirmDelete(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const duplicateEstimate = async (est: Estimate) => {
    if (!company) return
    const { data, error } = await supabase
      .from('estimates')
      .insert({
        company_id: company.id,
        client_name: `${est.client_name} (Copy)`,
        client_email: est.client_email,
        job_address: est.job_address,
        job_city: est.job_city,
        job_state: est.job_state,
        job_zip: est.job_zip,
        spec_source: est.spec_source,
        plan_url: est.plan_url,
        ai_conversation: est.ai_conversation,
        status: 'draft',
      })
      .select('*')
      .single()

    if (error) {
      toast.error('Failed to duplicate estimate')
      return
    }
    if (data) {
      setEstimates((prev) => [data, ...prev])
      setMenuOpen(null)
      toast.success('Estimate duplicated')
    }
  }

  useEffect(() => {
    if (!company) return
    const load = async () => {
      const { data } = await supabase
        .from('estimates')
        .select('*')
        .eq('company_id', company.id)
        .order('updated_at', { ascending: false })
      setEstimates(data ?? [])
      setLoading(false)
    }
    load()
  }, [company])

  const filtered = estimates.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.client_name.toLowerCase().includes(q) ||
        (e.job_address?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-navy">Estimates</h2>
          <p className="text-sm text-muted-foreground">
            {estimates.length} total estimate{estimates.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={onNewEstimate}
          className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-light transition-colors"
        >
          <PlusCircle size={18} />
          New Estimate
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by client or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'draft', 'approved', 'sent_to_quickcalc'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-navy text-white'
                  : 'bg-white text-muted-foreground hover:bg-muted'
              }`}
            >
              {s === 'all' ? 'All' : s === 'sent_to_quickcalc' ? 'Sent' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Estimate list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading estimates...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white py-16">
          <FileText size={48} className="mb-4 text-muted-foreground/40" />
          <p className="text-lg font-medium text-muted-foreground">
            {estimates.length === 0 ? 'No estimates yet' : 'No matching estimates'}
          </p>
          {estimates.length === 0 && (
            <button
              onClick={onNewEstimate}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-gold-dark"
            >
              <PlusCircle size={16} />
              Create your first estimate
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((est) => {
            const status = statusConfig[est.status as EstimateStatus] ?? statusConfig.draft
            return (
              <div key={est.id} className="relative">
                <button
                  onClick={() => onOpenEstimate(est.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-border bg-white p-4 text-left transition-colors hover:border-gold/40 hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-navy/5 text-navy">
                    <FileText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-navy">{est.client_name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[est.job_address, est.job_city, est.job_state].filter(Boolean).join(', ') || 'No address'}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}>
                      {status.icon}
                      {status.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(est.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>

                {/* Actions menu */}
                <div className="absolute right-2 top-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(menuOpen === est.id ? null : est.id)
                    }}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-navy"
                  >
                    <MoreVertical size={16} aria-hidden="true" />
                  </button>

                  {menuOpen === est.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMenuOpen(null)}
                      />
                      <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-white py-1 shadow-lg">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            duplicateEstimate(est)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Copy size={14} />
                          Duplicate
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDelete(est.id)
                            setMenuOpen(null)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/5"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Delete confirmation */}
                {confirmDelete === est.id && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-white/95 backdrop-blur-sm border border-destructive/30">
                    <div className="text-center px-4">
                      <p className="mb-3 text-sm font-medium text-navy">
                        Delete this estimate?
                      </p>
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => deleteEstimate(est.id)}
                          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
