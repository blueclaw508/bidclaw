import { useState, useMemo } from 'react'
import type { EstimateRecord, WorkAreaData, LineItemData } from '@/lib/types'
import { exportEstimateToExcel } from '@/lib/exportExcel'
import { ProgressIndicator } from './Step1ProjectInfo'
import { JamieEstimateSummary } from './JamieInsights'
import {
  Send,
  PenLine,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ExternalLink,
  PlusCircle,
  AlertTriangle,
  Layers,
  FileText,
  MapPin,
  User,
  Lock,
  X,
  Package,
  Clock,
  Table,
} from 'lucide-react'

interface Step4SendProps {
  estimate: EstimateRecord
  workAreas: WorkAreaData[]
  lineItems: Record<string, LineItemData[]>
  newCatalogItemCount: number
  onEdit: () => void
  onSend: () => void
  onNewEstimate: () => void
  // Jamie summary
  jamieSummary?: string | null
  jamieSummaryLoading?: boolean
  onJamieGenerateSummary?: () => void
  onJamieUpdateSummary?: (summary: string) => void
  // Trial gate
  isTrial?: boolean
  onUpgrade?: () => void
}

function SummaryWorkArea({
  workArea,
  items,
}: {
  workArea: WorkAreaData
  items: LineItemData[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <CheckCircle2 size={16} className="flex-shrink-0 text-green-500" />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-blue-900">{workArea.name}</span>
          <span className="ml-2 text-xs text-slate-400">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex-shrink-0 text-slate-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-2">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <div className="min-w-0 flex-1">Item</div>
            <div className="w-16 text-right">Qty</div>
            <div className="w-14 text-center">Unit</div>
            <div className="w-24 text-center">Category</div>
          </div>

          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 border-b border-slate-50 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm text-slate-700">{item.name}</span>
                {item.catalog_match_type === 'new_created' && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                    <AlertTriangle size={8} />
                    NEW
                  </span>
                )}
              </div>
              <div className="w-16 text-right text-sm text-slate-600">{item.quantity}</div>
              <div className="w-14 text-center text-sm text-slate-500">{item.unit}</div>
              <div className="w-24 text-center text-xs text-slate-400">{item.category}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Step4Send({
  estimate,
  workAreas,
  lineItems,
  newCatalogItemCount,
  onEdit,
  onSend,
  onNewEstimate,
  jamieSummary,
  jamieSummaryLoading,
  onJamieGenerateSummary,
  onJamieUpdateSummary,
  isTrial,
  onUpgrade,
}: Step4SendProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [showTrialModal, setShowTrialModal] = useState(false)

  const totalLineItems = Object.values(lineItems).reduce((sum, items) => sum + items.length, 0)

  // ── Pre-send estimate summary (quantities only — no pricing) ──
  const financials = useMemo(() => {
    let totalManHours = 0
    for (const items of Object.values(lineItems)) {
      for (const li of items) {
        if (li.category === 'Labor') {
          totalManHours += li.quantity || 0
        }
      }
    }
    const crewDays = totalManHours > 0 ? Math.ceil(totalManHours / 27) : 0
    return { totalManHours, crewDays }
  }, [lineItems])

  const handleSend = async () => {
    if (isTrial) {
      setShowTrialModal(true)
      return
    }
    setSending(true)
    try {
      onSend()
      setSent(true)
    } catch {
      // Error handled by parent
    } finally {
      setSending(false)
    }
  }

  // Success screen
  if (sent) {
    return (
      <div className="mx-auto max-w-3xl">
        <ProgressIndicator currentStep={4} />

        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-blue-900">Estimate Sent!</h2>
          <p className="mb-8 text-sm text-slate-500">
            Your estimate has been sent to BlueQuickCalc for pricing.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="https://bluequickcalc.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90"
            >
              <ExternalLink size={16} />
              Open BlueQuickCalc
            </a>
            <button
              onClick={onNewEstimate}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <PlusCircle size={16} />
              Start New Estimate
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={4} />

      <div className="space-y-4">
        {/* Summary card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-bold text-blue-900">Estimate Summary</h2>

          {/* Jamie Summary */}
          {onJamieGenerateSummary && (
            <div className="mb-6">
              <JamieEstimateSummary
                summary={jamieSummary ?? null}
                loading={jamieSummaryLoading ?? false}
                onGenerate={onJamieGenerateSummary}
                onUpdate={onJamieUpdateSummary ?? (() => {})}
              />
            </div>
          )}

          {/* Project details */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <User size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Client</p>
                <p className="text-sm font-medium text-blue-900">{estimate.client_name || 'Not specified'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Address</p>
                <p className="text-sm font-medium text-blue-900">{estimate.project_address || 'Not specified'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Work Areas</p>
                <p className="text-sm font-medium text-blue-900">{workAreas.length}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Line Items</p>
                <p className="text-sm font-medium text-blue-900">{totalLineItems}</p>
              </div>
            </div>
          </div>

          {/* ── Pre-send estimate summary (quantities only — no pricing) ── */}
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-900">
              <Clock size={16} />
              Estimate Summary
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Labor Hours</p>
                <p className="text-lg font-bold text-blue-900 tabular-nums">
                  {financials.totalManHours.toFixed(1)}
                  <span className="ml-1 text-xs font-normal text-slate-400">MH</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Crew Days</p>
                <p className="text-lg font-bold text-blue-900 tabular-nums">
                  {financials.crewDays}
                  <span className="ml-1 text-xs font-normal text-slate-400">days</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Work Areas</p>
                <p className="text-lg font-bold text-blue-900 tabular-nums">{workAreas.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Line Items</p>
                <p className="text-lg font-bold text-blue-900 tabular-nums">{totalLineItems}</p>
              </div>
            </div>
          </div>

          {/* New catalog items info */}
          {newCatalogItemCount > 0 && (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <Package size={16} className="flex-shrink-0 text-blue-600" />
              <p className="text-sm text-blue-800">
                <span className="font-semibold">{newCatalogItemCount} new catalog item{newCatalogItemCount !== 1 ? 's' : ''}</span>{' '}
                added during this estimate.
              </p>
            </div>
          )}

          {/* Work area summaries */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-600">Work Areas</h3>
            {workAreas.map((wa) => (
              <SummaryWorkArea
                key={wa.id}
                workArea={wa}
                items={lineItems[wa.id] ?? []}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <PenLine size={16} />
              Edit Estimate
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={() => { exportEstimateToExcel(estimate, workAreas, lineItems).catch(console.error) }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Table size={16} />
                EXPORT TO EXCEL
              </button>

              <button
                onClick={handleSend}
                disabled={sending}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-8 py-3 text-sm font-bold text-white transition-colors disabled:opacity-70 disabled:cursor-not-allowed ${
                  isTrial
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-[#2563EB] hover:bg-blue-600'
                }`}
              >
                {sending ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Sending...
                  </>
                ) : isTrial ? (
                  <>
                    <Lock size={16} />
                    SEND TO QUICKCALC
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    SEND TO QUICKCALC
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Trial upgrade modal */}
      {showTrialModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowTrialModal(false)} />
          <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl bg-white shadow-2xl">
            <button
              onClick={() => setShowTrialModal(false)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X size={20} />
            </button>
            <div className="flex flex-col items-center px-8 py-10 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                <Lock size={28} className="text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-3">
                Upgrade to Push Estimates
              </h2>
              <p className="text-sm leading-relaxed text-gray-600 mb-8 max-w-sm">
                You're on a free trial. Pushing estimates to QuickCalc is a paid feature. Upgrade to BidClaw for $599 to unlock full access.
              </p>
              <button
                onClick={() => { setShowTrialModal(false); onUpgrade?.() }}
                className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-sm cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90"
              >
                Upgrade to BidClaw — $599
              </button>
              <button
                onClick={() => setShowTrialModal(false)}
                className="mt-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Continue exploring trial
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
