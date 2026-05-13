// ============================================================
// V2 Step 4 — Export (Send to QuickCalc + Excel Download)
// Summary view with labor metrics, then two export paths.
// CSS matches existing Step4Send patterns.
// ============================================================

import { useState } from 'react'
import type { V2Estimate, V2WorkArea, V2LineItem } from '@/lib/types'
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  ArrowLeft,
  Check,
  Download,
  Send,
  Loader2,
  ExternalLink,
  Package,
} from 'lucide-react'

interface Step4ExportV2Props {
  estimate: V2Estimate
  workAreas: V2WorkArea[]
  lineItems: Map<string, V2LineItem[]>
  onSendToQuickCalc: () => Promise<{ success: boolean; newItemsCount: number; error?: string }>
  onExportExcel: () => Promise<void>
  onBack: () => void
}

export function Step4ExportV2({
  estimate,
  workAreas,
  lineItems,
  onSendToQuickCalc,
  onExportExcel,
  onBack,
}: Step4ExportV2Props) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(estimate.status === 'sent')
  const [sendError, setSendError] = useState<string | null>(null)
  const [newItemsCount, setNewItemsCount] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Calculate metrics
  const allItems = Array.from(lineItems.values()).flat()
  const totalItems = allItems.length
  const totalLaborHours = allItems
    .filter(li => li.category === 'Labor')
    .reduce((sum, li) => sum + li.qty, 0)
  const crewDays = totalLaborHours > 0 ? Math.ceil(totalLaborHours / 27) : 0
  const newCatalogItems = allItems.filter(li => li.match_status === 'new')

  const handleSend = async () => {
    setSending(true)
    setSendError(null)
    const result = await onSendToQuickCalc()
    setSending(false)

    if (result.success) {
      setSent(true)
      setNewItemsCount(result.newItemsCount)
    } else {
      setSendError(result.error ?? 'Failed to send')
    }
  }

  const handleExcel = async () => {
    setExporting(true)
    await onExportExcel()
    setExporting(false)
  }

  // ── Success State ──
  if (sent) {
    return (
      <div className="mx-auto max-w-3xl">
        <ProgressIndicator currentStep={4} />

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check size={32} className="text-green-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-blue-900">Estimate Sent to QuickCalc</h2>
          <p className="mb-6 text-sm text-slate-500">
            Jamie sent {totalItems} line items across {workAreas.length} work area{workAreas.length > 1 ? 's' : ''}.
            {newItemsCount > 0 && (
              <span className="block mt-1 text-blue-600">
                {newItemsCount} new item{newItemsCount > 1 ? 's' : ''} added to your catalog — set prices in QuickCalc.
              </span>
            )}
          </p>

          <div className="flex justify-center gap-3">
            <a
              href="https://bluequickcalc.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              Open BlueQuickCalc
              <ExternalLink size={14} />
            </a>
            <button
              onClick={handleExcel}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export Excel Too
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Pre-Send State ──
  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={4} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-blue-900">Review & Export</h2>
          <p className="text-sm text-slate-500">
            Send this estimate to QuickCalc for pricing, or download as Excel.
          </p>
        </div>

        {/* Estimate Summary */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-900">Estimate Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-bold text-blue-900">{workAreas.length}</p>
              <p className="text-xs text-slate-500">Work Areas</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-900">{totalItems}</p>
              <p className="text-xs text-slate-500">Line Items</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-900">{totalLaborHours.toFixed(0)}</p>
              <p className="text-xs text-slate-500">Labor Hours</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-900">{crewDays}</p>
              <p className="text-xs text-slate-500">Crew Days</p>
            </div>
          </div>
        </div>

        {/* New catalog items alert */}
        {newCatalogItems.length > 0 && (
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Package size={16} className="text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">
                {newCatalogItems.length} new item{newCatalogItems.length > 1 ? 's' : ''} will be added to your catalog
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {newCatalogItems.map(li => (
                <span key={li.id} className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                  {li.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Work area breakdown */}
        <div className="mb-6 space-y-2">
          {workAreas.map(wa => {
            const items = lineItems.get(wa.id) ?? []
            const waLabor = items
              .filter(li => li.category === 'Labor')
              .reduce((sum, li) => sum + li.qty, 0)
            return (
              <div key={wa.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5">
                <span className="text-sm font-medium text-slate-700">{wa.name}</span>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>{items.length} items</span>
                  {waLabor > 0 && <span>{waLabor.toFixed(1)} hrs</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Error */}
        {sendError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              Jamie hit a snag — {sendError}. Try again.
            </p>
          </div>
        )}

        {/* Export buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-t border-slate-100 pt-5">
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <div className="flex-1" />

          <button
            onClick={handleExcel}
            disabled={exporting}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export to Excel
          </button>

          <button
            onClick={handleSend}
            disabled={sending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Sending to QuickCalc...
              </>
            ) : (
              <>
                <Send size={16} />
                Send to QuickCalc
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
