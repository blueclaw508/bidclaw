import { useState } from 'react'
import type { WorkAreaData, LineItemData, CatalogItem } from '@/lib/types'
import type { JamieAnalysisResult } from '@/lib/jamie'
import { ProgressIndicator } from './Step1ProjectInfo'
import { LineItemRow } from './LineItemRow'
import { NewCatalogItemPrompt } from './NewCatalogItemPrompt'
import { JamieScopeWriter, JamieAnalysisPanel, JamieBuiltBanner } from './JamieInsights'
// roundManHours imported from types is used inline via Math.ceil pattern
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  PenLine,
  Send,
} from 'lucide-react'

interface Step3LineItemsProps {
  workAreas: WorkAreaData[]
  lineItems: Record<string, LineItemData[]>
  newCatalogItems: string[]
  loading: boolean
  loadingMessage?: string
  catalogItems?: CatalogItem[]
  onUpdateLineItem: (workAreaId: string, itemId: string, updates: Partial<LineItemData>) => void
  onRemoveLineItem: (workAreaId: string, itemId: string) => void
  onAddLineItem: (workAreaId: string) => void
  onAddCatalogLineItem?: (workAreaId: string, catalogItem: CatalogItem) => void
  onApproveWorkArea: (workAreaId: string) => void
  onUnapproveWorkArea: (workAreaId: string) => void
  onSend: () => void
  onBack: () => void
  onBackToStep1: () => void
  // Jamie
  jamieBuilt?: boolean
  jamieScopes?: Record<string, string>
  jamieScopeLoading?: string | null
  onJamieWriteScope?: (workAreaId: string) => void
  onJamieUpdateScope?: (workAreaId: string, scope: string) => void
  jamieAnalysis?: JamieAnalysisResult | null
  jamieAnalysisLoading?: boolean
  onJamieAnalyze?: () => void
}

interface WorkAreaSectionProps {
  workArea: WorkAreaData
  items: LineItemData[]
  catalogItems?: CatalogItem[]
  onUpdateItem: (itemId: string, updates: Partial<LineItemData>) => void
  onRemoveItem: (itemId: string) => void
  onAddItem: () => void
  onAddCatalogItem?: (catalogItem: CatalogItem) => void
  onApprove: () => void
  onUnapprove: () => void
  // Jamie scope
  jamieScope?: string | null
  jamieScopeLoading?: boolean
  onJamieWriteScope?: () => void
  onJamieUpdateScope?: (scope: string) => void
}

function WorkAreaSection({
  workArea,
  items,
  catalogItems,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onApprove,
  onUnapprove,
  onAddCatalogItem,
  jamieScope,
  jamieScopeLoading,
  onJamieWriteScope,
  onJamieUpdateScope,
}: WorkAreaSectionProps) {
  const [collapsed, setCollapsed] = useState(workArea.approved)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const hasItems = items.length > 0
  const newItemCount = items.filter((i) => i.catalog_match_type === 'new_created').length
  const laborItems = items.filter((i) => i.category === 'Labor')
  const totalManHours = laborItems.reduce((sum, i) => sum + (i.quantity || 0), 0)

  return (
    <div
      className={`rounded-xl border transition-colors ${
        workArea.approved ? 'border-green-200' : 'border-slate-200'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`flex w-full items-center gap-3 rounded-t-xl px-4 py-3 text-left transition-colors ${
          workArea.approved ? 'bg-green-50' : 'bg-slate-50'
        }`}
      >
        {workArea.approved && <CheckCircle2 size={18} className="flex-shrink-0 text-green-600" />}

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-blue-900">{workArea.name}</span>
          <span className="ml-2 text-xs text-slate-400">
            {items.length} item{items.length !== 1 ? 's' : ''}
            {newItemCount > 0 && (
              <span className="ml-1 text-yellow-600">
                ({newItemCount} new)
              </span>
            )}
          </span>
        </div>

        {workArea.approved ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onUnapprove()
            }}
            className="flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
          >
            <PenLine size={12} />
            Edit
          </button>
        ) : null}

        <div className="flex-shrink-0 text-slate-400">
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </div>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="bg-white rounded-b-xl">
          {/* Column headers */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <div className="min-w-0 flex-1">Item Name</div>
            <div className="w-20 text-center">Qty</div>
            <div className="w-20 text-center">Unit</div>
            <div className="hidden sm:block w-32 text-center">Category</div>
            <div className="w-6" />
            <div className="w-6" />
          </div>

          {/* Line items */}
          {items.map((lineItem) => (
            <LineItemRow
              key={lineItem.id}
              item={lineItem}
              onUpdate={(updates) => onUpdateItem(lineItem.id, updates)}
              onRemove={() => onRemoveItem(lineItem.id)}
              catalogItems={catalogItems}
            />
          ))}

          {/* Work Area Labor Hours subtotal */}
          {hasItems && totalManHours > 0 && (
            <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/50 px-3 py-2.5">
              <div className="min-w-0 flex-1 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Labor Hours
              </div>
              <div className="text-sm font-bold tabular-nums text-slate-700">
                {totalManHours.toFixed(1)} MH
              </div>
              <div className="w-6" />
              <div className="w-6" />
            </div>
          )}

          {/* Jamie Scope Writer */}
          {onJamieWriteScope && (
            <div className="border-t border-slate-100 px-3 py-3">
              <JamieScopeWriter
                scope={jamieScope ?? null}
                loading={jamieScopeLoading ?? false}
                onWrite={onJamieWriteScope}
                onUpdate={onJamieUpdateScope ?? (() => {})}
              />
            </div>
          )}


          {/* Add + Approve actions */}
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3">
            <div className="relative">
              <div className="flex items-center gap-1.5">
                {catalogItems && catalogItems.length > 0 && onAddCatalogItem && (
                  <button
                    onClick={() => { setShowCatalogPicker(!showCatalogPicker); setCatalogSearch('') }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors"
                  >
                    <Plus size={14} />
                    From Catalog
                  </button>
                )}
                <button
                  onClick={onAddItem}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={14} />
                  Custom Item
                </button>
              </div>
              {/* Catalog picker dropdown */}
              {showCatalogPicker && catalogItems && onAddCatalogItem && (
                <div className="absolute left-0 bottom-full z-30 mb-1 w-72 max-h-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  <div className="p-2 border-b border-slate-100">
                    <input
                      type="text"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Search catalog..."
                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto max-h-48">
                    {catalogItems
                      .filter((ci) => !catalogSearch || ci.name.toLowerCase().includes(catalogSearch.toLowerCase()))
                      .slice(0, 20)
                      .map((ci) => (
                        <button
                          key={ci.id}
                          onClick={() => {
                            onAddCatalogItem(ci)
                            setShowCatalogPicker(false)
                            setCatalogSearch('')
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-slate-50 last:border-b-0"
                        >
                          <span className="truncate flex-1 text-slate-700">{ci.name}</span>
                          <span className="flex-shrink-0 text-[10px] text-slate-400 uppercase">{ci.type}</span>
                        </button>
                      ))}
                    {catalogItems.filter((ci) => !catalogSearch || ci.name.toLowerCase().includes(catalogSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-400">No matches found</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!workArea.approved && (
              <button
                onClick={onApprove}
                disabled={!hasItems}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={14} />
                Approve Work Area
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Step3LineItems({
  workAreas,
  lineItems,
  newCatalogItems: _newCatalogItems,
  loading,
  loadingMessage,
  catalogItems,
  onUpdateLineItem,
  onRemoveLineItem,
  onAddLineItem,
  onAddCatalogLineItem,
  onApproveWorkArea,
  onUnapproveWorkArea,
  onSend,
  onBack,
  onBackToStep1,
  jamieBuilt,
  jamieScopes,
  jamieScopeLoading,
  onJamieWriteScope,
  onJamieUpdateScope,
  jamieAnalysis,
  jamieAnalysisLoading,
  onJamieAnalyze,
}: Step3LineItemsProps) {
  const approvedCount = workAreas.filter((wa) => wa.approved).length
  const totalCount = workAreas.length
  const allApproved = approvedCount === totalCount && totalCount > 0


  return (
    <div className="mx-auto max-w-4xl">
      <ProgressIndicator currentStep={3} />

      <div className="space-y-4">
        {/* Header */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-blue-900">Line Items</h2>
              <p className="text-sm text-slate-500">
                {loading
                  ? 'Jamie is generating line items for each work area...'
                  : 'Review and edit line items per work area'}
              </p>
            </div>
          </div>
        </div>

        {/* Jamie built banner */}
        {!loading && jamieBuilt && <JamieBuiltBanner />}

        {/* Jamie Analysis */}
        {!loading && onJamieAnalyze && (
          <JamieAnalysisPanel
            analysis={jamieAnalysis ?? null}
            loading={jamieAnalysisLoading ?? false}
            onAnalyze={onJamieAnalyze}
          />
        )}

        {/* Loading state — shows per-work-area progress */}
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <div className="h-10 w-10 animate-spin rounded-full border-3 border-slate-200 border-t-[#2563EB]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-900">
                  {loadingMessage || 'Generating line items...'}
                </p>
                {/* Progress bar */}
                {loadingMessage && loadingMessage.includes(' of ') && (() => {
                  const match = loadingMessage.match(/\((\d+) of (\d+)/)
                  if (!match) return null
                  const done = parseInt(match[1])
                  const total = parseInt(match[2])
                  const pct = total > 0 ? (done / total) * 100 : 0
                  return (
                    <div className="mt-3">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#2563EB] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-slate-400">
                        {done} of {total} work area{total !== 1 ? 's' : ''} complete
                      </p>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Work area sections with inline new item prompts — rendered incrementally as each completes */}
        {workAreas.map((wa) => {
            // During loading, only show work areas that have line items (completed by Jamie)
            if (loading && (!lineItems[wa.id] || lineItems[wa.id].length === 0)) return null
            const waItems = lineItems[wa.id] ?? []
            const newItems = waItems.filter((li) => li.catalog_match_type === 'new_created' && li.catalog_item_id)
            return (
              <div key={wa.id} className="space-y-2">
                <WorkAreaSection
                  workArea={wa}
                  items={waItems}
                  catalogItems={catalogItems}
                  onUpdateItem={(itemId, updates) => onUpdateLineItem(wa.id, itemId, updates)}
                  onRemoveItem={(itemId) => onRemoveLineItem(wa.id, itemId)}
                  onAddItem={() => onAddLineItem(wa.id)}
                  onAddCatalogItem={onAddCatalogLineItem ? (ci) => onAddCatalogLineItem(wa.id, ci) : undefined}
                  onApprove={() => onApproveWorkArea(wa.id)}
                  onUnapprove={() => onUnapproveWorkArea(wa.id)}
                  jamieScope={jamieScopes?.[wa.id]}
                  jamieScopeLoading={jamieScopeLoading === wa.id}
                  onJamieWriteScope={onJamieWriteScope ? () => onJamieWriteScope(wa.id) : undefined}
                  onJamieUpdateScope={onJamieUpdateScope ? (scope: string) => onJamieUpdateScope(wa.id, scope) : undefined}
                />
                {/* Inline new catalog item pricing prompts */}
                {newItems.length > 0 && (
                  <div className="space-y-2 pl-2">
                    {newItems.map((li) => (
                      <NewCatalogItemPrompt
                        key={li.catalog_item_id!}
                        itemName={li.name}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

        {/* Bottom bar */}
        {!loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            {/* Progress */}
            <div className="mb-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: totalCount > 0 ? `${(approvedCount / totalCount) * 100}%` : '0%' }}
                />
              </div>
              <span className="flex-shrink-0 text-sm font-medium text-slate-600">
                {approvedCount} of {totalCount} Work Areas Approved
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <button
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} />
                  Back to Work Areas
                </button>
                <button
                  onClick={onBackToStep1}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Back to Project Info
                </button>
              </div>

              <button
                onClick={onSend}
                disabled={!allApproved}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} />
                Send to QuickCalc
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
