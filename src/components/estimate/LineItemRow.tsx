import { useState, useRef, useEffect, useCallback } from 'react'
import type { LineItemData, LineItemUnit, LineItemCategory, CatalogItem } from '@/lib/types'
import {
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface LineItemRowProps {
  item: LineItemData
  onUpdate: (updates: Partial<LineItemData>) => void
  onRemove: () => void
  catalogItems?: CatalogItem[]
}

const UNITS: LineItemUnit[] = ['SF', 'LF', 'CY', 'SY', 'EA', 'LS', 'HR', 'Day', 'Allow']
const CATEGORIES: LineItemCategory[] = ['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Disposal']

export function LineItemRow({ item, onUpdate, onRemove, catalogItems }: LineItemRowProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(item.name)
  const [qtyValue, setQtyValue] = useState(String(item.quantity))
  const [descExpanded, setDescExpanded] = useState(false)
  const [descValue, setDescValue] = useState(item.description)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [typeaheadResults, setTypeaheadResults] = useState<CatalogItem[]>([])
  const [showTypeahead, setShowTypeahead] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const typeaheadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setNameValue(item.name)
    setQtyValue(String(item.quantity))
    setDescValue(item.description)
  }, [item.name, item.quantity, item.description])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  // Close typeahead on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (typeaheadRef.current && !typeaheadRef.current.contains(e.target as Node)) {
        setShowTypeahead(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleNameChange = useCallback(
    (value: string) => {
      setNameValue(value)
      if (catalogItems && value.length >= 2) {
        const q = value.toLowerCase()
        const matches = catalogItems
          .filter((c) => c.name.toLowerCase().includes(q))
          .slice(0, 8)
        setTypeaheadResults(matches)
        setShowTypeahead(matches.length > 0)
      } else {
        setShowTypeahead(false)
      }
    },
    [catalogItems]
  )

  const selectTypeaheadItem = (catalogItem: CatalogItem) => {
    setNameValue(catalogItem.name)
    setShowTypeahead(false)
    onUpdate({ name: catalogItem.name, catalog_item_id: catalogItem.id, catalog_match_type: 'matched' })
    setEditingName(false)
  }

  const saveName = () => {
    setEditingName(false)
    setShowTypeahead(false)
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== item.name) {
      onUpdate({ name: trimmed })
    } else {
      setNameValue(item.name)
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveName()
    if (e.key === 'Escape') {
      setNameValue(item.name)
      setEditingName(false)
      setShowTypeahead(false)
    }
  }

  const saveQuantity = () => {
    const num = parseFloat(qtyValue)
    if (!isNaN(num) && num >= 0 && num !== item.quantity) {
      onUpdate({ quantity: num })
    } else {
      setQtyValue(String(item.quantity))
    }
  }

  const saveDescription = () => {
    const trimmed = descValue.trim()
    if (trimmed !== item.description) {
      onUpdate({ description: trimmed })
    }
  }

  const isNew = item.catalog_match_type === 'new_created'
  const isMatched = item.catalog_match_type === 'matched' || item.catalog_match_type === 'fuzzy_matched'
  const unitCost = item.unit_cost ?? null
  const lineTotal = unitCost != null && item.quantity > 0 ? item.quantity * unitCost : null

  return (
    <div className="group border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Name with typeahead */}
        <div className="relative min-w-0 flex-1" ref={typeaheadRef}>
          {editingName ? (
            <>
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={() => {
                  // Delay to allow typeahead click
                  setTimeout(() => {
                    if (!showTypeahead) saveName()
                  }, 200)
                }}
                onKeyDown={handleNameKeyDown}
                className="w-full rounded border border-[#2563EB] bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
              {showTypeahead && typeaheadResults.length > 0 && (
                <div className="absolute left-0 top-full z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {typeaheadResults.map((ci) => (
                    <button
                      key={ci.id}
                      onClick={() => selectTypeaheadItem(ci)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50"
                    >
                      <span className="truncate text-slate-700">{ci.name}</span>
                      <span className="flex-shrink-0 text-xs text-slate-400">{ci.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingName(true)}
                className="truncate text-sm text-slate-700 hover:text-[#2563EB] text-left"
                title="Click to edit"
              >
                {item.name}
              </button>
              {/* Match badge */}
              {isMatched && (
                <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                  <CheckCircle2 size={10} />
                  Catalog
                </span>
              )}
              {isNew && (
                <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                  <AlertTriangle size={10} />
                  NEW
                </span>
              )}
            </div>
          )}
        </div>

        {/* Quantity */}
        <input
          type="number"
          value={qtyValue}
          onChange={(e) => setQtyValue(e.target.value)}
          onBlur={saveQuantity}
          onKeyDown={(e) => e.key === 'Enter' && saveQuantity()}
          min={0}
          step="any"
          className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-center text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        />

        {/* Unit dropdown */}
        <select
          value={item.unit}
          onChange={(e) => onUpdate({ unit: e.target.value as LineItemUnit })}
          className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        {/* Category dropdown */}
        <select
          value={item.category}
          onChange={(e) => onUpdate({ category: e.target.value as LineItemCategory })}
          className="hidden sm:block w-32 rounded border border-slate-200 bg-white px-1.5 py-1 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Unit Cost */}
        <div className="hidden sm:block w-20 text-right text-sm text-slate-500 tabular-nums">
          {unitCost != null ? (
            <span>${unitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          ) : isNew ? (
            <span className="text-[10px] font-medium text-yellow-600">Needs Price</span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>

        {/* Line Total */}
        <div className="hidden sm:block w-24 text-right text-sm font-medium tabular-nums">
          {lineTotal != null ? (
            <span className="text-slate-700">${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>

        {/* Description toggle */}
        <button
          onClick={() => setDescExpanded(!descExpanded)}
          className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          title="Toggle description"
        >
          {descExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Delete */}
        {showDeleteConfirm ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setShowDeleteConfirm(false)
                onRemove()
              }}
              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
            >
              Yes
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-200"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex-shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
            aria-label="Delete line item"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Expanded description */}
      {descExpanded && (
        <div className="px-3 pb-3">
          <textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            onBlur={saveDescription}
            rows={2}
            placeholder="Line item description..."
            className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-y"
          />
          {/* Category on mobile */}
          <div className="mt-2 sm:hidden">
            <label className="text-xs text-slate-500">Category:</label>
            <select
              value={item.category}
              onChange={(e) => onUpdate({ category: e.target.value as LineItemCategory })}
              className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs outline-none focus:border-[#2563EB]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
