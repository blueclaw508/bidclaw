import { useState, useRef, useEffect } from 'react'
import type { WorkAreaData } from '@/lib/types'
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  AlertTriangle,
} from 'lucide-react'

interface Step2WorkAreasProps {
  workAreas: WorkAreaData[]
  onUpdateWorkArea: (id: string, updates: Partial<WorkAreaData>) => void
  onRemoveWorkArea: (id: string) => void
  onAddWorkArea: (name: string) => void
  onApprove: () => void
  onBack: () => void
}

const SUGGESTION_CHIPS = [
  'Patio', 'Walkway', 'Retaining Wall', 'Seat Wall', 'Steps',
  'Fire Pit', 'Planting', 'Sod', 'Drainage', 'Landscape Lighting',
  'Driveway', 'Fence',
]

export function Step2WorkAreas({
  workAreas,
  onUpdateWorkArea,
  onRemoveWorkArea,
  onAddWorkArea,
  onApprove,
  onBack,
}: Step2WorkAreasProps) {
  const [inputValue, setInputValue] = useState('')
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onAddWorkArea(trimmed)
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const handleChipClick = (name: string) => {
    // Don't add duplicates
    const exists = workAreas.some(
      (wa) => wa.name.toLowerCase() === name.toLowerCase()
    )
    if (!exists) {
      onAddWorkArea(name)
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
            Add the work areas you need estimated. Jamie will build the line items on the next step.
          </p>
        </div>

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
          />
          <button
            onClick={handleAdd}
            disabled={!inputValue.trim()}
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
              (wa) => wa.name.toLowerCase() === chip.toLowerCase()
            )
            return (
              <button
                key={chip}
                onClick={() => handleChipClick(chip)}
                disabled={alreadyAdded}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  alreadyAdded
                    ? 'border-green-200 bg-green-50 text-green-600 cursor-default'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB] cursor-pointer'
                }`}
              >
                {alreadyAdded ? '✓ ' : ''}{chip}
              </button>
            )
          })}
        </div>

        {/* Work area list */}
        {workAreas.length > 0 && (
          <div className="space-y-3 mb-6">
            {workAreas.map((wa) => (
              <WorkAreaEntry
                key={wa.id}
                workArea={wa}
                onUpdate={(updates) => onUpdateWorkArea(wa.id, updates)}
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

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Project Info
          </button>

          <button
            onClick={onApprove}
            disabled={workAreas.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue to Estimate
            <ArrowRight size={16} />
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
              Going back to Project Info will discard your current work areas. Are you sure?
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

// ── Individual Work Area Entry ──

function WorkAreaEntry({
  workArea,
  onUpdate,
  onRemove,
}: {
  workArea: WorkAreaData
  onUpdate: (updates: Partial<WorkAreaData>) => void
  onRemove: () => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(workArea.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNameValue(workArea.name)
  }, [workArea.name])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  const saveName = () => {
    setEditingName(false)
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== workArea.name) {
      onUpdate({ name: trimmed })
    } else {
      setNameValue(workArea.name)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') {
                setNameValue(workArea.name)
                setEditingName(false)
              }
            }}
            className="w-full rounded border border-[#2563EB] bg-white px-2 py-1 text-sm font-semibold text-blue-900 outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="text-left text-sm font-semibold text-blue-900 hover:text-[#2563EB] transition-colors"
            title="Click to rename"
          >
            {workArea.name}
          </button>
        )}
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
