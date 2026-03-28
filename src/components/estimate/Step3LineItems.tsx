import { useState } from 'react'
import type { WorkAreaData, LineItemData, CatalogItem, GapQuestion, WorkAreaEstimateMode } from '@/lib/types'
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
  HelpCircle,
  RefreshCw,
  Loader2,
  AlertTriangle,
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
  // Mode detection & gap questions (Change B)
  workAreaModes?: Record<string, WorkAreaEstimateMode>
  structuredGapQuestions?: Record<string, GapQuestion[]>
  onReEstimateWorkArea?: (workAreaId: string, answers: GapQuestion[]) => void
  reEstimateLoading?: boolean
  planReferences?: Record<string, string[]>
  jamieMessages?: Record<string, string>
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
  // Mode detection & gap questions
  estimateMode?: WorkAreaEstimateMode
  gapQuestions?: GapQuestion[]
  onReEstimate?: (answers: GapQuestion[]) => void
  reEstimateLoading?: boolean
  jamieMessage?: string
  planReferences?: string[]
}

// ── Mode 2 Targeted Chat (Change B — replaces static gap form) ──
function GapQuestionsForm({
  questions,
  onReEstimate,
  loading,
  onSkip,
  jamieMessage,
  planReferences,
}: {
  questions: GapQuestion[]
  onReEstimate: (answers: GapQuestion[]) => void
  loading: boolean
  onSkip?: () => void
  jamieMessage?: string
  planReferences?: string[]
}) {
  const [answers, setAnswers] = useState<Record<number, string | number>>({})
  const [customInputs, setCustomInputs] = useState<Record<number, boolean>>({})

  const updateAnswer = (idx: number, value: string | number) => {
    setAnswers((prev) => ({ ...prev, [idx]: value }))
  }

  const requiredAnswered = questions
    .filter((q) => q.required)
    .every((_q, origIdx) => {
      const idx = origIdx
      const a = answers[idx]
      return a !== undefined && a !== ''
    })

  const handleSubmit = () => {
    const answered = questions.map((q, idx) => ({
      ...q,
      answer: answers[idx] ?? q.answer,
    }))
    onReEstimate(answered)
  }

  return (
    <div className="space-y-3">
      {/* Jamie's message — what she found on the plan */}
      {jamieMessage && (
        <div className="rounded-lg bg-white border border-amber-200 p-3">
          <p className="text-xs font-semibold text-blue-900 mb-1">Jamie</p>
          <p className="text-xs text-slate-700 leading-relaxed">{jamieMessage}</p>
        </div>
      )}

      {/* Plan references — compact proof of reading */}
      {planReferences && planReferences.length > 0 && (
        <div className="rounded-md bg-blue-50 px-3 py-2">
          <p className="text-[10px] font-semibold text-blue-700 mb-1">Found on plan:</p>
          <div className="flex flex-wrap gap-1">
            {planReferences.map((ref, i) => (
              <span key={i} className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800">
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Questions with option chips */}
      {questions.map((q, idx) => (
        <div key={idx} className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-700">
            {q.question}
            {q.required && <span className="ml-0.5 text-red-500">*</span>}
          </label>

          {/* Select type — render as clickable chips */}
          {(q.type === 'select' || q.type === 'single_select') && q.options ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    updateAnswer(idx, opt)
                    setCustomInputs((prev) => ({ ...prev, [idx]: false }))
                  }}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    answers[idx] === opt
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50'
                  }`}
                >
                  {opt}
                </button>
              ))}
              {/* Custom / Other input */}
              {q.allow_custom !== false && (
                <button
                  onClick={() => {
                    setCustomInputs((prev) => ({ ...prev, [idx]: true }))
                    updateAnswer(idx, '')
                  }}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    customInputs[idx]
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-dashed border-slate-300 text-slate-400 hover:border-amber-300 hover:text-slate-600'
                  }`}
                >
                  Other...
                </button>
              )}
              {customInputs[idx] && (
                <input
                  type="text"
                  autoFocus
                  value={(answers[idx] as string) ?? ''}
                  onChange={(e) => updateAnswer(idx, e.target.value)}
                  placeholder={q.custom_unit ? `Enter ${q.custom_unit}` : 'Enter value'}
                  className="w-32 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              )}
            </div>
          ) : q.type === 'number' ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                value={(answers[idx] as number) ?? ''}
                onChange={(e) => updateAnswer(idx, parseFloat(e.target.value) || 0)}
                className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              {q.unit && <span className="text-xs text-slate-400">{q.unit}</span>}
            </div>
          ) : (
            <input
              type="text"
              value={(answers[idx] as string) ?? ''}
              onChange={(e) => updateAnswer(idx, e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          )}
        </div>
      ))}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!requiredAnswered || loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Build Takeoff
        </button>
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip — I'll fill in manually
          </button>
        )}
      </div>
    </div>
  )
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
  estimateMode,
  gapQuestions,
  onReEstimate,
  reEstimateLoading,
  jamieMessage,
  planReferences,
}: WorkAreaSectionProps) {
  const [collapsed, setCollapsed] = useState(workArea.approved)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const hasItems = items.length > 0
  const newItemCount = items.filter((i) => i.catalog_match_type === 'new_created').length
  const laborItems = items.filter((i) => i.category === 'Labor')
  const totalManHours = laborItems.reduce((sum, i) => sum + (i.quantity || 0), 0)
  const isNeedsInfo = estimateMode === 'needs_info'
  const isAllowance = estimateMode === 'allowance'

  return (
    <div
      className={`rounded-xl border transition-colors ${
        workArea.approved
          ? 'border-green-200'
          : isNeedsInfo || isAllowance
          ? 'border-amber-200'
          : 'border-slate-200'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`flex w-full items-center gap-3 rounded-t-xl px-4 py-3 text-left transition-colors ${
          workArea.approved
            ? 'bg-green-50'
            : isNeedsInfo || isAllowance
            ? 'bg-amber-50'
            : 'bg-slate-50'
        }`}
      >
        {workArea.approved && <CheckCircle2 size={18} className="flex-shrink-0 text-green-600" />}
        {!workArea.approved && (isNeedsInfo || isAllowance) && (
          <HelpCircle size={18} className="flex-shrink-0 text-amber-500" />
        )}

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
          {(isNeedsInfo || isAllowance) && !workArea.approved && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {isNeedsInfo ? 'Needs Info' : 'Allowance'}
            </span>
          )}
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
          {/* Mode 2 — Jamie needs info */}
          {(isNeedsInfo || isAllowance) && !workArea.approved && gapQuestions && gapQuestions.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50/50 px-4 py-3">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">
                    Jamie needs more info to estimate this work area
                  </p>
                </div>
              </div>
              {onReEstimate && (
                <GapQuestionsForm
                  questions={gapQuestions}
                  onReEstimate={onReEstimate}
                  loading={reEstimateLoading ?? false}
                  onSkip={() => onApprove()}
                  jamieMessage={jamieMessage}
                  planReferences={planReferences}
                />
              )}
            </div>
          )}

          {/* Mode 1 — Plan references (proof Jamie read the plan) */}
          {!isNeedsInfo && !isAllowance && planReferences && planReferences.length > 0 && (
            <div className="border-b border-slate-100 bg-blue-50/50 px-4 py-2">
              <p className="text-[10px] font-semibold text-blue-600 mb-1">From plan:</p>
              <div className="flex flex-wrap gap-1">
                {planReferences.map((ref, i) => (
                  <span key={i} className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          )}

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
            <div
              key={lineItem.id}
              className={lineItem.placeholder ? 'opacity-50' : ''}
            >
              <LineItemRow
                item={lineItem}
                onUpdate={(updates) => onUpdateItem(lineItem.id, updates)}
                onRemove={() => onRemoveItem(lineItem.id)}
                catalogItems={catalogItems}
              />
              {lineItem.placeholder && lineItem.placeholder_note && (
                <div className="px-4 pb-1 -mt-1">
                  <span className="text-[10px] italic text-amber-500">{lineItem.placeholder_note}</span>
                </div>
              )}
            </div>
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
  workAreaModes,
  structuredGapQuestions,
  onReEstimateWorkArea,
  reEstimateLoading,
  planReferences: planRefsMap,
  jamieMessages: jamieMessagesMap,
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
                  estimateMode={workAreaModes?.[wa.id]}
                  gapQuestions={structuredGapQuestions?.[wa.id]}
                  onReEstimate={onReEstimateWorkArea ? (answers) => onReEstimateWorkArea(wa.id, answers) : undefined}
                  reEstimateLoading={reEstimateLoading}
                  jamieMessage={jamieMessagesMap?.[wa.id]}
                  planReferences={planRefsMap?.[wa.id]}
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
