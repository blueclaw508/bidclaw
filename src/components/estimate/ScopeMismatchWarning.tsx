// ScopeMismatchWarning — Inline warning card for scope/line-item mismatches
// Shows when Jamie mentioned something in scope but it's not in line items (or vice versa).
// User can add the missing line item with one click or dismiss.

import { useState } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'

interface ScopeMismatchWarningProps {
  warnings: string[]  // from crossValidateScopeAndItems
  workAreaId: string
  onAddLineItem: (workAreaId: string, itemName: string) => void
  onDismiss?: () => void
}

export function ScopeMismatchWarning({
  warnings,
  workAreaId,
  onAddLineItem,
  onDismiss,
}: ScopeMismatchWarningProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [allDismissed, setAllDismissed] = useState(false)

  if (warnings.length === 0 || allDismissed) return null

  const visibleWarnings = warnings.filter((_, i) => !dismissed.has(i))
  if (visibleWarnings.length === 0) return null

  const handleDismissOne = (index: number) => {
    setDismissed((prev) => new Set([...prev, index]))
  }

  const handleDismissAll = () => {
    setAllDismissed(true)
    onDismiss?.()
  }

  // Extract item name from warning string: 'Line item "Polymeric Sand" (Materials) not mentioned...'
  const extractItemName = (warning: string): string => {
    const match = warning.match(/Line item "([^"]+)"/)
    return match ? match[1] : ''
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">
            Jamie flagged {visibleWarnings.length} possible mismatch{visibleWarnings.length !== 1 ? 'es' : ''}
          </span>
        </div>
        <button
          onClick={handleDismissAll}
          className="text-amber-400 hover:text-amber-600 transition-colors"
          aria-label="Dismiss all"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-1.5">
        {warnings.map((warning, i) => {
          if (dismissed.has(i)) return null
          const itemName = extractItemName(warning)
          const isScopeMissing = warning.includes('not mentioned in scope')
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-md bg-white/60 px-2.5 py-1.5"
            >
              <p className="text-xs text-amber-900 flex-1 min-w-0">
                {isScopeMissing ? (
                  <>
                    <span className="font-medium">{itemName}</span> is in the line items but not mentioned in the scope.
                  </>
                ) : (
                  <>
                    <span className="font-medium">{itemName}</span> is mentioned in the scope but missing from line items.
                  </>
                )}
              </p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isScopeMissing ? (
                  <button
                    onClick={() => handleDismissOne(i)}
                    className="rounded px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    OK
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onAddLineItem(workAreaId, itemName)
                      handleDismissOne(i)
                    }}
                    className="inline-flex items-center gap-0.5 rounded bg-[#2563EB] px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-600 transition-colors"
                  >
                    <Plus size={10} />
                    Add Item
                  </button>
                )}
                <button
                  onClick={() => handleDismissOne(i)}
                  className="text-amber-400 hover:text-amber-600"
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
