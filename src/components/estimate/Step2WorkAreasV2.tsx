// ============================================================
// V2 Step 2 — Work Areas + Plan Findings Panel
// Shows Jamie's Pass 1 extraction, lets user name work areas,
// then triggers Pass 2. All CSS matches existing Step2WorkAreas.
// ============================================================

import { useState, useRef, useEffect } from 'react'
import type { V2Pass1Extraction, V2WorkArea } from '@/lib/types'
import type { Pass2V2Progress } from '@/lib/pass2V2'
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Eye,
} from 'lucide-react'

interface Step2WorkAreasV2Props {
  workAreas: V2WorkArea[]
  pass1Extraction: V2Pass1Extraction | null
  pass1Confidence?: string | null
  pass2Loading: boolean
  pass2Progress: Pass2V2Progress | null
  pass2Error: string | null
  onAddWorkArea: (name: string) => Promise<V2WorkArea | null>
  onRemoveWorkArea: (id: string) => Promise<void>
  onContinueToEstimate: () => void
  onBack: () => void
}

const SUGGESTION_CHIPS = [
  'Patio', 'Walkway', 'Retaining Wall', 'Seat Wall', 'Steps',
  'Fire Pit', 'Planting', 'Sod', 'Drainage', 'Landscape Lighting',
  'Driveway', 'Fence',
]

// ── Plan Findings Panel ──

function PlanFindingsPanel({ extraction }: { extraction: V2Pass1Extraction }) {
  const [expanded, setExpanded] = useState(false)

  // Build summary list from extraction
  const summaryItems: string[] = []

  for (const q of extraction.quantities ?? []) {
    summaryItems.push(`(${q.count}) ${q.item}${q.size ? ` — ${q.size}` : ''}`)
  }
  for (const m of extraction.materials ?? []) {
    summaryItems.push(`${m.item}${m.spec ? ` — ${m.spec}` : ''}`)
  }
  for (const d of extraction.dimensions ?? []) {
    summaryItems.push(`${d.item}: ${d.value}`)
  }
  for (const z of extraction.areas_zones ?? []) {
    summaryItems.push(`${z.name}${z.approx_sf ? ` (~${z.approx_sf} SF)` : ''}`)
  }

  const displayItems = expanded ? summaryItems : summaryItems.slice(0, 7)
  const hasMore = summaryItems.length > 7

  if (summaryItems.length === 0) return null

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Eye size={18} className="text-[#2563EB]" />
          <span className="text-sm font-semibold text-blue-900">
            Jamie found on the plans:
          </span>
          <span className="rounded-full bg-[#2563EB] px-2 py-0.5 text-xs font-bold text-white">
            {summaryItems.length}
          </span>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-slate-400" />
        ) : (
          <ChevronDown size={16} className="text-slate-400" />
        )}
      </button>

      <div className={`mt-3 space-y-1 overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[2000px]' : 'max-h-[200px]'}`}>
        {displayItems.map((item, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="mt-0.5 text-[#2563EB]">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
        {!expanded && hasMore && (
          <p className="text-xs text-slate-400 mt-2">
            ... and {summaryItems.length - 7} more items
          </p>
        )}
      </div>

      {/* Existing conditions and unknowns */}
      {expanded && (
        <>
          {(extraction.existing_conditions?.length ?? 0) > 0 && (
            <div className="mt-3 border-t border-blue-200 pt-3">
              <p className="text-xs font-semibold text-slate-600 mb-1">Existing Conditions:</p>
              {extraction.existing_conditions!.map((ec, idx) => (
                <div key={idx} className="text-xs text-slate-500">
                  &bull; {ec.item} — {ec.note}
                </div>
              ))}
            </div>
          )}
          {(extraction.unknowns?.length ?? 0) > 0 && (
            <div className="mt-3 border-t border-blue-200 pt-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Could not determine:</p>
              {extraction.unknowns!.map((u, idx) => (
                <div key={idx} className="text-xs text-amber-600">
                  &bull; {u.item} — {u.note}
                </div>
              ))}
            </div>
          )}
          {extraction.scale && (
            <div className="mt-2 text-xs text-slate-500">
              Scale: {extraction.scale}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Work Area Entry ──

function WorkAreaEntry({
  workArea,
  onRemove,
}: {
  workArea: V2WorkArea
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-blue-900">
          {workArea.name}
        </span>
      </div>
      <button
        onClick={onRemove}
        className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        aria-label="Remove work area"
      >
        <X size={16} />
      </button>
    </div>
  )
}

// ── Main Component ──

export function Step2WorkAreasV2({
  workAreas,
  pass1Extraction,
  pass1Confidence: _pass1Confidence,
  pass2Loading,
  pass2Progress,
  pass2Error,
  onAddWorkArea,
  onRemoveWorkArea,
  onContinueToEstimate,
  onBack,
}: Step2WorkAreasV2Props) {
  const [inputValue, setInputValue] = useState('')
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleAdd = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    await onAddWorkArea(trimmed)
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const handleChipClick = async (name: string) => {
    const exists = workAreas.some(
      wa => wa.name.toLowerCase() === name.toLowerCase()
    )
    if (!exists) {
      await onAddWorkArea(name)
    }
    inputRef.current?.focus()
  }

  const handleBack = () => {
    if (workAreas.length > 0) {
      setShowBackConfirm(true)
    } else {
      onBack()
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={2} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-blue-900">Work Areas</h2>
          <p className="text-sm text-slate-500">
            {pass1Extraction
              ? "Jamie studied the plans. Name the work areas you need estimated."
              : "Add the work areas you need estimated. Jamie will build the line items on the next step."}
          </p>
        </div>

        {/* Plan findings panel — only shows if Pass 1 ran */}
        {pass1Extraction && (
          <PlanFindingsPanel extraction={pass1Extraction} />
        )}

        {/* Input field */}
        <div className="mb-4 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a work area name..."
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            disabled={pass2Loading}
          />
          <button
            onClick={handleAdd}
            disabled={!inputValue.trim() || pass2Loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {/* Suggestion chips */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SUGGESTION_CHIPS.map((chip) => {
            const alreadyAdded = workAreas.some(
              wa => wa.name.toLowerCase() === chip.toLowerCase()
            )
            return (
              <button
                key={chip}
                onClick={() => handleChipClick(chip)}
                disabled={alreadyAdded || pass2Loading}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  alreadyAdded
                    ? 'border-green-200 bg-green-50 text-green-600 cursor-default'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB] cursor-pointer'
                }`}
              >
                {alreadyAdded ? '\u2713 ' : ''}{chip}
              </button>
            )
          })}
        </div>

        {/* Work area list */}
        {workAreas.length > 0 && (
          <div className="space-y-3 mb-6">
            {workAreas.map(wa => (
              <WorkAreaEntry
                key={wa.id}
                workArea={wa}
                onRemove={() => onRemoveWorkArea(wa.id)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {workAreas.length === 0 && (
          <div className="mb-6 rounded-lg border-2 border-dashed border-slate-200 py-10 text-center">
            <p className="text-sm text-slate-400">
              No work areas yet. Type a name above or click a suggestion chip.
            </p>
          </div>
        )}

        {/* Pass 2 error */}
        {pass2Error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              Jamie hit a snag — {pass2Error}. Try again or adjust your scope.
            </p>
          </div>
        )}

        {/* Pass 2 progress */}
        {pass2Loading && pass2Progress && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-[#2563EB]" />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  Jamie is estimating {pass2Progress.currentWorkAreaName}...
                </p>
                <p className="text-xs text-slate-500">
                  {pass2Progress.completedCount} of {pass2Progress.totalCount} work areas complete
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-blue-100">
              <div
                className="h-1.5 rounded-full bg-[#2563EB] transition-all duration-500"
                style={{ width: `${(pass2Progress.completedCount / pass2Progress.totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          <button
            onClick={handleBack}
            disabled={pass2Loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <ArrowLeft size={16} />
            Back to Project Info
          </button>

          <button
            onClick={onContinueToEstimate}
            disabled={workAreas.length === 0 || pass2Loading}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pass2Loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Jamie is estimating...
              </>
            ) : (
              <>
                Continue to Estimate
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Back confirmation dialog */}
      {showBackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">Go Back?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Going back to Project Info will keep your work areas. You can return here anytime.
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
    </div>
  )
}
