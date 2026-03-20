import { useState } from 'react'
import type { EstimateRecord, WorkAreaData, LineItemData } from '@/lib/types'
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
          {/* Column headers */}
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
}: Step4SendProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const totalLineItems = Object.values(lineItems).reduce((sum, items) => sum + items.length, 0)

  const handleSend = async () => {
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
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
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
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Client
                </p>
                <p className="text-sm font-medium text-blue-900">
                  {estimate.client_name || 'Not specified'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Address
                </p>
                <p className="text-sm font-medium text-blue-900">
                  {estimate.project_address || 'Not specified'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Work Areas
                </p>
                <p className="text-sm font-medium text-blue-900">{workAreas.length}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText size={16} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Total Line Items
                </p>
                <p className="text-sm font-medium text-blue-900">{totalLineItems}</p>
              </div>
            </div>
          </div>

          {/* New catalog items warning */}
          {newCatalogItemCount > 0 && (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
              <AlertTriangle size={16} className="flex-shrink-0 text-yellow-600" />
              <p className="text-sm text-yellow-800">
                <span className="font-semibold">{newCatalogItemCount} new catalog item{newCatalogItemCount !== 1 ? 's' : ''}</span>{' '}
                will need pricing in QuickCalc.
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

            <button
              onClick={handleSend}
              disabled={sending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-70"
            >
              {sending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Sending...
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
  )
}
