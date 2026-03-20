import { useState, useRef, useEffect } from 'react'
import type { WorkAreaData } from '@/lib/types'
import { CheckCircle2, Trash2 } from 'lucide-react'

interface WorkAreaCardProps {
  workArea: WorkAreaData
  onUpdate: (updates: Partial<WorkAreaData>) => void
  onRemove: () => void
}

const complexityColors: Record<string, string> = {
  Simple: 'bg-green-100 text-green-700',
  Moderate: 'bg-yellow-100 text-yellow-700',
  Complex: 'bg-red-100 text-red-700',
}

const DESCRIPTION_TEMPLATE = `Line 1: Overall description of what is being done
Line 2: Material / brand / type qualifier
Line 3: Size qualifier(s)
Step 1: ...
Step 2: ...
Step 3: ...
Disposal fees included.`

export function WorkAreaCard({ workArea, onUpdate, onRemove }: WorkAreaCardProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(workArea.name)
  const [descValue, setDescValue] = useState(workArea.description || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNameValue(workArea.name)
    setDescValue(workArea.description || '')
  }, [workArea.name, workArea.description])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  // Auto-resize textarea
  useEffect(() => {
    if (descRef.current) {
      descRef.current.style.height = 'auto'
      descRef.current.style.height = descRef.current.scrollHeight + 'px'
    }
  }, [descValue])

  const saveName = () => {
    setEditingName(false)
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== workArea.name) {
      onUpdate({ name: trimmed })
    } else {
      setNameValue(workArea.name)
    }
  }

  const saveDescription = () => {
    const trimmed = descValue.trim()
    if (trimmed !== workArea.description) {
      onUpdate({ description: trimmed })
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveName()
    if (e.key === 'Escape') {
      setNameValue(workArea.name)
      setEditingName(false)
    }
  }

  return (
    <div
      className={`rounded-xl border transition-colors ${
        workArea.approved
          ? 'border-green-200 bg-green-50/50'
          : 'border-slate-200 bg-white'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-3 rounded-t-xl px-4 py-3 ${
          workArea.approved ? 'bg-green-100/60' : 'bg-slate-50'
        }`}
      >
        {workArea.approved && (
          <CheckCircle2 size={18} className="flex-shrink-0 text-green-600" />
        )}

        <div className="min-w-0 flex-1">
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={handleNameKeyDown}
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

        {/* Complexity badge */}
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            complexityColors[workArea.complexity] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {workArea.complexity}
        </span>

        {/* Delete button */}
        {!workArea.approved && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            aria-label="Remove work area"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Body — Description always visible and editable */}
      <div className="px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Scope Description
        </label>
        <textarea
          ref={descRef}
          value={descValue}
          onChange={(e) => setDescValue(e.target.value)}
          onBlur={saveDescription}
          placeholder={DESCRIPTION_TEMPLATE}
          rows={7}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 leading-relaxed outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-y font-mono"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Format: Description &rarr; Material/brand &rarr; Size &rarr; Steps &rarr; Disposal note
        </p>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="border-t border-slate-200 bg-red-50/50 px-4 py-3">
          <p className="mb-2 text-xs font-medium text-red-700">
            Remove this work area? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowDeleteConfirm(false)
                onRemove()
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
