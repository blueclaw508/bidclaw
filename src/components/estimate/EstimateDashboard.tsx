import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type { EstimateRecord, ApprovalStatus } from '@/lib/types'
import {
  PlusCircle,
  Search,
  FileText,
  Clock,
  CheckCircle2,
  Send,
  MoreVertical,
  Trash2,
  Copy,
  Layers,
  PenLine,
  ClipboardList,
} from 'lucide-react'
import { PageLayout } from '@/components/PageLayout'

interface EstimateDashboardProps {
  onNewEstimate: () => void
  onOpenEstimate: (id: string) => void
}

type FilterStatus = ApprovalStatus | 'all'

const statusConfig: Record<ApprovalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: {
    label: 'Draft',
    color: 'bg-yellow-100 text-yellow-800',
    icon: <Clock size={14} />,
  },
  work_areas_approved: {
    label: 'Work Areas Approved',
    color: 'bg-orange-100 text-orange-800',
    icon: <Layers size={14} />,
  },
  line_items_approved: {
    label: 'Line Items Approved',
    color: 'bg-green-100 text-green-800',
    icon: <CheckCircle2 size={14} />,
  },
  sent: {
    label: 'Sent to QuickCalc',
    color: 'bg-blue-100 text-blue-800',
    icon: <Send size={14} />,
  },
}

const filterOptions: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'work_areas_approved', label: 'Work Areas' },
  { value: 'line_items_approved', label: 'Line Items' },
  { value: 'sent', label: 'Sent' },
]

export function EstimateDashboard({ onNewEstimate, onOpenEstimate }: EstimateDashboardProps) {
  const { user } = useAuth()
  const [estimates, setEstimates] = useState<EstimateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Fetch estimates
  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { data } = await supabase
        .from('estimates')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      setEstimates((data as EstimateRecord[]) ?? [])
      setLoading(false)
    }
    load()
  }, [user])

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

  const deleteEstimate = async (id: string) => {
    const { error } = await supabase.from('estimates').delete().eq('id', id)
    if (error) {
      toast.error('Failed to delete estimate')
      return
    }
    setEstimates((prev) => prev.filter((e) => e.id !== id))
    setConfirmDelete(null)
    setMenuOpen(null)
    toast.success('Estimate deleted')
  }

  const duplicateEstimate = async (est: EstimateRecord) => {
    if (!user) return
    const { data, error } = await supabase
      .from('estimates')
      .insert({
        user_id: user.id,
        client_name: est.client_name ? `${est.client_name} (Copy)` : 'Untitled (Copy)',
        project_name: est.project_name ? `${est.project_name} (Copy)` : null,
        project_address: est.project_address,
        project_description: est.project_description,
        plan_file_urls: est.plan_file_urls,
        workflow_step: 1,
        work_areas: est.work_areas,
        line_items: est.line_items,
        new_catalog_items_created: null,
        approval_status: 'draft' as ApprovalStatus,
      })
      .select('*')
      .single()

    if (error) {
      toast.error('Failed to duplicate estimate')
      return
    }
    if (data) {
      setEstimates((prev) => [data as EstimateRecord, ...prev])
      setMenuOpen(null)
      toast.success('Estimate duplicated')
    }
  }

  const getWorkAreaCount = (est: EstimateRecord): number => {
    return est.work_areas?.length ?? 0
  }

  const filtered = estimates.filter((e) => {
    if (statusFilter !== 'all' && e.approval_status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (e.project_name?.toLowerCase().includes(q) ?? false) ||
        (e.client_name?.toLowerCase().includes(q) ?? false) ||
        (e.project_address?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  return (
    <PageLayout
      icon={<ClipboardList size={24} />}
      title="Estimates"
      subtitle={`${estimates.length} total estimate${estimates.length !== 1 ? 's' : ''} — create, review, and send to QuickCalc`}
    >
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-end">
        <button
          onClick={onNewEstimate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1e40af] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e3a8a] transition-colors"
        >
          <PlusCircle size={18} />
          New Estimate
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by client name or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>
        <div className="flex gap-2">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estimate list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-[#2563EB]" />
            Loading estimates...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16">
          <FileText size={48} className="mb-4 text-slate-300" />
          <p className="text-lg font-medium text-slate-400">
            {estimates.length === 0 ? 'No estimates yet' : 'No matching estimates'}
          </p>
          {estimates.length === 0 && (
            <button
              onClick={onNewEstimate}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#2563EB] hover:text-blue-700"
            >
              <PlusCircle size={16} />
              Create your first estimate
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((est) => {
            const status = statusConfig[est.approval_status] ?? statusConfig.draft
            const workAreaCount = getWorkAreaCount(est)
            return (
              <div key={est.id} className="relative">
                <button
                  onClick={() => onOpenEstimate(est.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-200 hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
                    <PenLine size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-blue-900">
                      {est.project_name || est.client_name || 'Untitled Estimate'}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {est.project_address || 'No address'}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
                    <Layers size={14} />
                    {workAreaCount} work area{workAreaCount !== 1 ? 's' : ''}
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}
                    >
                      {status.icon}
                      {status.label}
                    </span>
                    <span className="text-xs text-slate-400">
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
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-900"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {menuOpen === est.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            duplicateEstimate(est)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Delete confirmation overlay */}
                {confirmDelete === est.id && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-white/95 backdrop-blur-sm border border-red-200">
                    <div className="text-center px-4">
                      <p className="mb-3 text-sm font-medium text-blue-900">Delete this estimate?</p>
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => deleteEstimate(est.id)}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
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
    </PageLayout>
  )
}
