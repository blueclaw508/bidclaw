// Jamie's Opening Question — Work Area Mode Selection
// Shown after user fills project info and clicks Generate.
// Asks how the user wants to handle work areas before Jamie does anything.

import { useState } from 'react'
import { FileSearch, PenLine, Plus, X, ArrowRight, Loader2 } from 'lucide-react'
import { ProgressIndicator } from './Step1ProjectInfo'
import { JamieLoadingButton } from '@/components/JamieLoadingButton'

interface JamieWorkAreaChoiceProps {
  contractorFirstName: string
  clientName: string
  onPullFromPlan: () => void
  onManualSubmit: (workAreaNames: string[]) => void
  loading: boolean
}

export function JamieWorkAreaChoice({
  contractorFirstName,
  clientName,
  onPullFromPlan,
  onManualSubmit,
  loading,
}: JamieWorkAreaChoiceProps) {
  const [mode, setMode] = useState<'choice' | 'manual' | null>(null)
  const [manualAreas, setManualAreas] = useState<string[]>([''])

  const addRow = () => setManualAreas((prev) => [...prev, ''])
  const removeRow = (i: number) => setManualAreas((prev) => prev.filter((_, idx) => idx !== i))
  const updateRow = (i: number, val: string) =>
    setManualAreas((prev) => prev.map((v, idx) => (idx === i ? val : v)))

  const validAreas = manualAreas.filter((a) => a.trim().length > 0)

  const handleManualSubmit = () => {
    if (validAreas.length === 0) return
    onManualSubmit(validAreas.map((a) => a.trim()))
  }

  // Manual work area entry mode
  if (mode === 'manual') {
    return (
      <div className="mx-auto max-w-3xl">
        <ProgressIndicator currentStep={2} />

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <img
              src="/jamie-avatar.png"
              alt="Jamie"
              className="h-10 w-10 rounded-full object-cover flex-shrink-0"
            />
            <h2 className="text-lg font-bold text-blue-900">
              Tell me what to estimate.
            </h2>
          </div>

          {/* Work area input rows */}
          <div className="space-y-2 mb-4">
            {manualAreas.map((area, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={area}
                  onChange={(e) => updateRow(i, e.target.value)}
                  placeholder="e.g. Bluestone Patio, Planting Beds, Cobblestone Edging"
                  autoFocus={i === manualAreas.length - 1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && area.trim()) addRow()
                  }}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                />
                {manualAreas.length > 1 && (
                  <button
                    onClick={() => removeRow(i)}
                    className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    aria-label="Remove work area"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mb-6 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors"
          >
            <Plus size={14} />
            Add Work Area
          </button>

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-5">
            <button
              onClick={() => setMode(null)}
              disabled={loading}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Back
            </button>
            <JamieLoadingButton
              defaultLabel="Build My Estimate"
              loadingLabel="Jamie is building..."
              loading={loading}
              disabled={validAreas.length === 0}
              onClick={handleManualSubmit}
              icon={<ArrowRight size={16} />}
            />
          </div>
        </div>
      </div>
    )
  }

  // Choice mode (default) — Jamie's opening question
  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={2} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start gap-4">
          <img
            src="/jamie-avatar.png"
            alt="Jamie"
            className="h-12 w-12 rounded-full object-cover flex-shrink-0"
          />
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Hi{contractorFirstName ? ` ${contractorFirstName}` : ''}.
              I've got the project info for{' '}
              <span className="font-semibold text-blue-900">{clientName || 'this project'}</span>.
            </p>
            <p className="mt-1 text-sm font-medium text-blue-900">
              Want me to pull the work areas from the plan, or would you rather tell me what to estimate?
            </p>
          </div>
        </div>

        {/* Two buttons side by side */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {loading ? (
            <button
              disabled
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#2563EB] bg-blue-50 px-4 py-4 text-sm font-semibold text-[#2563EB]"
            >
              <Loader2 size={18} className="animate-spin" />
              Jamie is on it...
            </button>
          ) : (
            <button
              onClick={() => { onPullFromPlan() }}
              className="flex items-center justify-center gap-3 rounded-xl border-2 border-slate-200 px-4 py-4 text-sm font-semibold text-slate-700 cursor-pointer transition-all duration-100 hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB] active:scale-95 active:brightness-90"
            >
              <FileSearch size={20} />
              Pull them from the plan
            </button>
          )}
          <button
            onClick={() => setMode('manual')}
            disabled={loading}
            className="flex items-center justify-center gap-3 rounded-xl border-2 border-slate-200 px-4 py-4 text-sm font-semibold text-slate-700 cursor-pointer transition-all duration-100 hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB] active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PenLine size={20} />
            I'll provide them
          </button>
        </div>

        {/* Status line when loading */}
        {loading && (
          <p className="mt-4 text-center text-xs text-slate-400 animate-pulse">
            Jamie is reading the plan...
          </p>
        )}
      </div>
    </div>
  )
}
