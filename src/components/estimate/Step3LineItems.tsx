import { useState } from 'react'
import type { WorkAreaData, LineItemData, CatalogItem } from '@/lib/types'
import type { JamieAnalysisResult } from '@/lib/jamie'
import { ProgressIndicator } from './Step1ProjectInfo'
import { LineItemRow } from './LineItemRow'
import { NewCatalogItemPrompt } from './NewCatalogItemPrompt'
import { ScopeMismatchWarning } from './ScopeMismatchWarning'
import { crossValidateScopeAndItems } from '@/lib/jamiePrompt'
import { JamieScopeWriter, JamieAnalysisPanel, JamieBuiltBanner } from './JamieInsights'
// roundManHours imported from types is used inline via Math.ceil pattern
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  PenLine,
  AlertTriangle,
  Send,
  Users,
  RotateCcw,
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
  onApproveWorkArea: (workAreaId: string) => void
  onUnapproveWorkArea: (workAreaId: string) => void
  onUpdateWorkArea?: (workAreaId: string, updates: Partial<WorkAreaData>) => void
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
  onNewItemPriceSaved?: (catalogItemId: string, price: number) => void
  onAddMismatchItem?: (workAreaId: string, itemName: string) => void
}

interface WorkAreaSectionProps {
  workArea: WorkAreaData
  items: LineItemData[]
  catalogItems?: CatalogItem[]
  onUpdateItem: (itemId: string, updates: Partial<LineItemData>) => void
  onRemoveItem: (itemId: string) => void
  onAddItem: () => void
  onApprove: () => void
  onUnapprove: () => void
  onUpdateWorkArea?: (updates: Partial<WorkAreaData>) => void
  onRoundManHours?: () => void
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
  onUpdateWorkArea,
  onRoundManHours,
  jamieScope,
  jamieScopeLoading,
  onJamieWriteScope,
  onJamieUpdateScope,
}: WorkAreaSectionProps) {
  const [collapsed, setCollapsed] = useState(workArea.approved)
  const hasItems = items.length > 0
  const newItemCount = items.filter((i) => i.catalog_match_type === 'new_created').length
  const laborItems = items.filter((i) => i.category === 'Labor')
  const totalManHours = laborItems.reduce((sum, i) => sum + (i.quantity || 0), 0)
  const unpricedCount = items.filter((i) => i.unit_cost == null).length
  const workAreaTotal = items.reduce((sum, i) => {
    const cost = i.unit_cost ?? 0
    return sum + (i.quantity * cost)
  }, 0)

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
            <div className="hidden sm:block w-20 text-right">Unit Cost</div>
            <div className="hidden sm:block w-24 text-right">Total</div>
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

          {/* Work Area Subtotal */}
          {hasItems && (
            <div className="hidden sm:flex items-center gap-2 border-t border-slate-200 bg-slate-50/50 px-3 py-2.5">
              <div className="min-w-0 flex-1 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Work Area Total
                {unpricedCount > 0 && (
                  <span className="ml-2 text-[10px] font-medium text-yellow-600 normal-case tracking-normal">
                    ({unpricedCount} item{unpricedCount !== 1 ? 's' : ''} unpriced)
                  </span>
                )}
              </div>
              <div className="w-20" />
              <div className="w-24 text-right text-sm font-bold tabular-nums text-slate-700">
                ${workAreaTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

          {/* Crew Size & Man Hours */}
          {onUpdateWorkArea && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-3 py-3 bg-slate-50/50">
              <Users size={14} className="text-slate-400" />
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Crew</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={workArea.crew_size ?? 3}
                  onChange={(e) => onUpdateWorkArea({ crew_size: parseInt(e.target.value) || 3 })}
                  className="w-14 rounded-md border border-slate-200 px-2 py-1 text-center text-xs focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Hrs/Day</label>
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={0.5}
                  value={workArea.crew_hours_per_day ?? 8}
                  onChange={(e) => onUpdateWorkArea({ crew_hours_per_day: parseFloat(e.target.value) || 8 })}
                  className="w-14 rounded-md border border-slate-200 px-2 py-1 text-center text-xs focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              {totalManHours > 0 && (
                <>
                  <span className="text-xs text-slate-500">
                    {totalManHours.toFixed(1)} MH
                    {' · '}
                    {((totalManHours / ((workArea.crew_size ?? 3) * (workArea.crew_hours_per_day ?? 8))) || 0).toFixed(1)} days
                  </span>
                  <button
                    onClick={onRoundManHours}
                    className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-blue-600 transition-colors"
                    title="Round labor man hours to nearest crew-day increment"
                  >
                    <RotateCcw size={10} />
                    Round
                  </button>
                </>
              )}
            </div>
          )}

          {/* Add + Approve actions */}
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3">
            <button
              onClick={onAddItem}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors"
            >
              <Plus size={14} />
              Add Line Item
            </button>

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
  onApproveWorkArea,
  onUnapproveWorkArea,
  onUpdateWorkArea,
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
  onNewItemPriceSaved,
  onAddMismatchItem,
}: Step3LineItemsProps) {
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const [showBackToStep1Confirm, setShowBackToStep1Confirm] = useState(false)

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
                  onApprove={() => onApproveWorkArea(wa.id)}
                  onUnapprove={() => onUnapproveWorkArea(wa.id)}
                  onUpdateWorkArea={onUpdateWorkArea ? (updates) => onUpdateWorkArea(wa.id, updates) : undefined}
                  onRoundManHours={onUpdateWorkArea ? () => {
                    const crewSize = wa.crew_size ?? 3
                    const hrsPerDay = wa.crew_hours_per_day ?? 8
                    const crewDay = crewSize * hrsPerDay
                    if (crewDay <= 0) return
                    for (const item of waItems) {
                      if (item.category === 'Labor' && item.quantity > 0) {
                        const rounded = Math.ceil(item.quantity / crewDay) * crewDay
                        if (rounded !== item.quantity) {
                          onUpdateLineItem(wa.id, item.id, { quantity: rounded })
                        }
                      }
                    }
                  } : undefined}
                  jamieScope={jamieScopes?.[wa.id]}
                  jamieScopeLoading={jamieScopeLoading === wa.id}
                  onJamieWriteScope={onJamieWriteScope ? () => onJamieWriteScope(wa.id) : undefined}
                  onJamieUpdateScope={onJamieUpdateScope ? (scope: string) => onJamieUpdateScope(wa.id, scope) : undefined}
                />
                {/* Scope/line-item mismatch warnings */}
                {!loading && jamieScopes?.[wa.id] && waItems.length > 0 && onAddMismatchItem && (() => {
                  const warnings = crossValidateScopeAndItems(jamieScopes[wa.id], waItems)
                  if (warnings.length === 0) return null
                  return (
                    <ScopeMismatchWarning
                      warnings={warnings}
                      workAreaId={wa.id}
                      onAddLineItem={onAddMismatchItem}
                    />
                  )
                })()}
                {/* Inline new catalog item pricing prompts */}
                {newItems.length > 0 && onNewItemPriceSaved && (
                  <div className="space-y-2 pl-2">
                    {newItems.map((li) => (
                      <NewCatalogItemPrompt
                        key={li.catalog_item_id!}
                        catalogItemId={li.catalog_item_id!}
                        itemName={li.name}
                        itemType={li.category === 'Materials' ? 'material'
                          : li.category === 'Subcontractor' ? 'subcontractor'
                          : li.category === 'Equipment' ? 'equipment'
                          : 'other'}
                        onPriceSaved={onNewItemPriceSaved}
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
                  onClick={() => setShowBackConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} />
                  Back to Work Areas
                </button>
                <button
                  onClick={() => setShowBackToStep1Confirm(true)}
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

      {/* Back to Work Areas confirmation */}
      {showBackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">Go Back to Work Areas?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Going back will discard all line items and approval progress. Are you sure?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBackConfirm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Stay Here
              </button>
              <button
                onClick={() => {
                  setShowBackConfirm(false)
                  onBack()
                }}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back to Step 1 confirmation */}
      {showBackToStep1Confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">Go Back to Project Info?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Going back to Step 1 will discard all work areas, line items, and approval progress.
              Are you sure?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBackToStep1Confirm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Stay Here
              </button>
              <button
                onClick={() => {
                  setShowBackToStep1Confirm(false)
                  onBackToStep1()
                }}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
