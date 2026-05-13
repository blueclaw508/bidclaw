// ============================================================
// V2 Step 3 — Review & Edit (scope + line items + catalog match)
// User reviews Jamie's output, edits scope, adjusts items,
// overrides catalog matches. All CSS matches existing patterns.
// ============================================================

import { useState, useRef } from 'react'
import type { V2WorkArea, V2LineItem, V2LineItemCategory, V2MatchStatus, CatalogItem, V2Pass1ClientInfo } from '@/lib/types'
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  ArrowLeft,
  Plus,
  Check,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Send,
  Download,
  Loader2,
  ExternalLink,
  Package,
} from 'lucide-react'

// ── Customer Info Fields ──

export interface CustomerInfo {
  first_name: string
  last_name: string
  company_name: string
  phone: string
  email: string
  estimate_name: string
  address_line: string
  city: string
  state: string
  zip: string
}

interface Step3ReviewV2Props {
  workAreas: V2WorkArea[]
  lineItems: Map<string, V2LineItem[]>
  catalogItems: CatalogItem[]
  onUpdateScope: (workAreaId: string, scope: string) => Promise<void>
  onAddItem: (workAreaId: string, item: Omit<V2LineItem, 'id' | 'created_at' | 'estimate_id' | 'sort_order'>) => Promise<V2LineItem | null>
  onUpdateItem: (id: string, updates: Partial<V2LineItem>) => Promise<void>
  onRemoveItem: (id: string, workAreaId: string) => Promise<void>
  onBack: () => void
  // v3: customer info
  customerInfo: CustomerInfo
  onCustomerInfoChange: (updates: Partial<CustomerInfo>) => void
  clientInfoFound?: V2Pass1ClientInfo | null
  // v3: inline export
  onSendToQuickCalc: () => Promise<{ success: boolean; newItemsCount: number; error?: string }>
  onExportExcel: () => Promise<void>
  isTrial?: boolean
  onUpgrade?: () => void
}

const CATEGORIES: V2LineItemCategory[] = ['Materials', 'Equipment', 'Labor', 'Subcontractor', 'Other']
const COMMON_UNITS = ['SF', 'LF', 'CY', 'SY', 'EA', 'HR', 'BAG', 'TON', 'GAL', 'ALLOW']

// ── Catalog Match Badge ──

function MatchBadge({ status }: { status: V2MatchStatus | null }) {
  if (status === 'exact' || status === 'fuzzy') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
        <Check size={10} /> Catalog
      </span>
    )
  }
  if (status === 'manual') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
        Manual
      </span>
    )
  }
  if (status === 'new') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">
        <AlertTriangle size={10} /> NEW
      </span>
    )
  }
  return null
}

// ── Searchable Catalog Dropdown ──

function CatalogDropdown({
  currentName: _currentName,
  catalogItems,
  onSelect,
}: {
  currentName: string
  catalogItems: CatalogItem[]
  onSelect: (item: CatalogItem | null, customName?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = search.length >= 2
    ? catalogItems.filter(ci =>
        ci.name.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : []

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#2563EB] transition-colors"
      >
        <Search size={12} />
        Match to catalog
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-20 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search catalog items..."
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>

          {filtered.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-slate-100">
              {filtered.map(ci => (
                <button
                  key={ci.id}
                  onClick={() => {
                    onSelect(ci)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 transition-colors"
                >
                  <span className="font-medium text-slate-700">{ci.name}</span>
                  <span className="text-[10px] text-slate-400">{ci.type}</span>
                </button>
              ))}
            </div>
          )}

          {search.length >= 2 && filtered.length === 0 && (
            <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
              No matches. Item will be created as new in QuickCalc.
            </div>
          )}

          <div className="border-t border-slate-100 px-3 py-2">
            <button
              onClick={() => { setOpen(false); setSearch('') }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Line Item Row ──

function LineItemRowV2({
  item,
  catalogItems,
  onUpdate,
  onRemove,
}: {
  item: V2LineItem
  catalogItems: CatalogItem[]
  onUpdate: (updates: Partial<V2LineItem>) => void
  onRemove: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleCatalogSelect = (ci: CatalogItem | null) => {
    if (ci) {
      const typeToCategory: Record<string, V2LineItemCategory> = {
        material: 'Materials', labor: 'Labor', equipment: 'Equipment',
        subcontractor: 'Subcontractor', other: 'Other',
      }
      onUpdate({
        catalog_item_id: ci.id,
        match_status: 'manual' as V2MatchStatus,
        name: ci.name,
        category: typeToCategory[ci.type] ?? item.category,
        unit: (ci.type === 'labor' || ci.type === 'equipment') ? 'HR' : item.unit,
      })
    }
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 hover:border-slate-200 transition-colors">
      {/* Name + match badge */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-700">{item.name}</span>
          <MatchBadge status={item.match_status} />
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <CatalogDropdown
            currentName={item.name}
            catalogItems={catalogItems}
            onSelect={handleCatalogSelect}
          />
          {item.original_name && item.original_name !== item.name && (
            <span className="text-[10px] text-slate-400">was: {item.original_name}</span>
          )}
        </div>
      </div>

      {/* Qty */}
      <input
        type="number"
        value={item.qty}
        onChange={e => onUpdate({ qty: parseFloat(e.target.value) || 0 })}
        className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        min={0}
        step="any"
      />

      {/* Unit */}
      <span className="w-12 text-center text-xs text-slate-500">{item.unit}</span>

      {/* Category */}
      <span className="hidden sm:inline w-24 text-xs text-slate-400">{item.category}</span>

      {/* Delete */}
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <button
            onClick={onRemove}
            className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded px-2 py-1 text-[10px] text-slate-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex-shrink-0 rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ── Add Item Form ──

function AddItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, qty: number, unit: string, category: V2LineItemCategory) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [unit, setUnit] = useState('EA')
  const [category, setCategory] = useState<V2LineItemCategory>('Materials')

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="grid grid-cols-[1fr_80px_80px_120px] gap-2 mb-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Item name"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-[#2563EB]"
          autoFocus
        />
        <input
          type="number"
          value={qty}
          onChange={e => setQty(parseFloat(e.target.value) || 0)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm text-right outline-none focus:border-[#2563EB]"
          min={0}
          step="any"
        />
        <select
          value={unit}
          onChange={e => setUnit(e.target.value)}
          className="rounded border border-slate-300 px-1 py-1.5 text-xs outline-none focus:border-[#2563EB]"
        >
          {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select
          value={category}
          onChange={e => setCategory(e.target.value as V2LineItemCategory)}
          className="rounded border border-slate-300 px-1 py-1.5 text-xs outline-none focus:border-[#2563EB]"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
        <button
          onClick={() => { if (name.trim()) onAdd(name.trim(), qty, unit, category) }}
          disabled={!name.trim()}
          className="rounded bg-[#2563EB] px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Add Item
        </button>
      </div>
    </div>
  )
}

// ── Work Area Section ──

function WorkAreaSection({
  workArea,
  items,
  catalogItems,
  onUpdateScope,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: {
  workArea: V2WorkArea
  items: V2LineItem[]
  catalogItems: CatalogItem[]
  onUpdateScope: (scope: string) => void
  onAddItem: (name: string, qty: number, unit: string, category: V2LineItemCategory) => void
  onUpdateItem: (id: string, updates: Partial<V2LineItem>) => void
  onRemoveItem: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingScope, setEditingScope] = useState(false)
  const [scopeValue, setScopeValue] = useState(workArea.scope_description ?? '')

  const laborHours = items
    .filter(li => li.category === 'Labor')
    .reduce((sum, li) => sum + li.qty, 0)

  const newItemsCount = items.filter(li => li.match_status === 'new').length

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-slate-50 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-blue-900">{workArea.name}</h3>
          <span className="text-xs text-slate-400">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
          {laborHours > 0 && (
            <span className="text-xs text-slate-400">
              {laborHours.toFixed(1)} labor hrs
            </span>
          )}
          {newItemsCount > 0 && (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">
              {newItemsCount} new
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="p-4">
          {/* Scope description */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Scope Description</label>
              <button
                onClick={() => setEditingScope(!editingScope)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#2563EB]"
              >
                <Pencil size={12} />
                {editingScope ? 'Done' : 'Edit'}
              </button>
            </div>
            {editingScope ? (
              <textarea
                value={scopeValue}
                onChange={e => setScopeValue(e.target.value)}
                onBlur={() => {
                  setEditingScope(false)
                  if (scopeValue !== workArea.scope_description) {
                    onUpdateScope(scopeValue)
                  }
                }}
                rows={6}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-y font-mono"
                autoFocus
              />
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 whitespace-pre-wrap">
                {workArea.scope_description || 'No scope description yet.'}
              </div>
            )}
          </div>

          {/* Column headers */}
          <div className="mb-1 flex items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <div className="flex-1">Name</div>
            <div className="w-20 text-right">Qty</div>
            <div className="w-12 text-center">Unit</div>
            <div className="hidden sm:block w-24">Category</div>
            <div className="w-8" />
          </div>

          {/* Line items */}
          <div className="space-y-1 mb-3">
            {items.map(li => (
              <LineItemRowV2
                key={li.id}
                item={li}
                catalogItems={catalogItems}
                onUpdate={updates => onUpdateItem(li.id, updates)}
                onRemove={() => onRemoveItem(li.id)}
              />
            ))}
          </div>

          {/* Labor subtotal */}
          {laborHours > 0 && (
            <div className="mb-3 rounded-lg bg-slate-50/50 border-t border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium text-slate-600">Labor Hours:</span>{' '}
              <span className="font-bold text-blue-900">{laborHours.toFixed(1)} hrs</span>
              {laborHours >= 27 && (
                <span className="ml-2 text-xs text-slate-400">
                  ({Math.ceil(laborHours / 27)} crew day{Math.ceil(laborHours / 27) > 1 ? 's' : ''})
                </span>
              )}
            </div>
          )}

          {/* Add item */}
          {showAddForm ? (
            <AddItemForm
              onAdd={(name, qty, unit, category) => {
                onAddItem(name, qty, unit, category)
                setShowAddForm(false)
              }}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors"
            >
              <Plus size={14} />
              Add Item
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Customer Info Section ──

function CustomerInfoSection({
  info,
  onChange,
  expanded,
  onToggle,
  missingFields,
}: {
  info: CustomerInfo
  onChange: (updates: Partial<CustomerInfo>) => void
  expanded: boolean
  onToggle: () => void
  missingFields: string[]
}) {
  const field = (label: string, key: keyof CustomerInfo, placeholder: string, className?: string) => (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input
        type="text"
        value={info[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 ${
          missingFields.includes(key) ? 'border-red-300 bg-red-50/30' : 'border-slate-300'
        }`}
      />
    </div>
  )

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-3 bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-blue-900">Customer Info</span>
          {missingFields.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
              {missingFields.length} required
            </span>
          )}
          {missingFields.length === 0 && info.first_name && (
            <span className="text-xs text-slate-400">
              {info.first_name} {info.last_name}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field('First Name *', 'first_name', 'First name')}
            {field('Last Name *', 'last_name', 'Last name')}
          </div>
          {field('Company', 'company_name', 'Company name (optional)', 'col-span-full')}
          {field('Address *', 'address_line', 'Street address')}
          <div className="grid grid-cols-[1fr_80px_100px] gap-3">
            {field('City *', 'city', 'City')}
            {field('State *', 'state', 'ST')}
            {field('Zip *', 'zip', 'Zip')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('Phone', 'phone', 'Phone')}
            {field('Email', 'email', 'Email')}
          </div>
          {field('Estimate Name', 'estimate_name', 'e.g., Smith Patio & Planting')}
        </div>
      )}
    </div>
  )
}

// ── Main Component ──

export function Step3ReviewV2({
  workAreas,
  lineItems,
  catalogItems,
  onUpdateScope,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onBack,
  customerInfo,
  onCustomerInfoChange,
  clientInfoFound: _clientInfoFound,
  onSendToQuickCalc,
  onExportExcel,
  isTrial,
  onUpgrade,
}: Step3ReviewV2Props) {
  const [customerExpanded, setCustomerExpanded] = useState(true)
  const [sending, setSending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState<'qc' | 'excel' | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [newItemsCount, setNewItemsCount] = useState(0)
  const customerRef = useRef<HTMLDivElement>(null)

  const totalItems = Array.from(lineItems.values()).reduce((sum, items) => sum + items.length, 0)
  const allItems = Array.from(lineItems.values()).flat()
  const totalLaborHours = allItems.filter(li => li.category === 'Labor').reduce((sum, li) => sum + li.qty, 0)
  const crewDays = totalLaborHours > 0 ? Math.ceil(totalLaborHours / 27) : 0
  const newCatalogItems = allItems.filter(li => li.match_status === 'new')

  // Required fields for export
  const REQUIRED: (keyof CustomerInfo)[] = ['first_name', 'last_name', 'address_line', 'city', 'state', 'zip']
  const missingFields = REQUIRED.filter(k => !customerInfo[k]?.trim())
  const canExport = missingFields.length === 0 && totalItems > 0

  const scrollToCustomer = () => {
    setCustomerExpanded(true)
    setTimeout(() => customerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const handleSend = async () => {
    if (!canExport) { scrollToCustomer(); return }
    if (isTrial) { onUpgrade?.(); return }
    setSending(true)
    setSendError(null)
    const result = await onSendToQuickCalc()
    setSending(false)
    if (result.success) {
      setExportSuccess('qc')
      setNewItemsCount(result.newItemsCount)
    } else {
      setSendError(result.error ?? 'Failed to send')
    }
  }

  const handleExcel = async () => {
    if (!canExport) { scrollToCustomer(); return }
    setExporting(true)
    await onExportExcel()
    setExporting(false)
    setExportSuccess('excel')
  }

  // ── Inline Success State ──
  if (exportSuccess) {
    return (
      <div className="mx-auto max-w-4xl">
        <ProgressIndicator currentStep={3} />
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check size={32} className="text-green-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-blue-900">
            {exportSuccess === 'qc' ? 'Estimate Sent to QuickCalc' : 'Excel Downloaded'}
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            {workAreas.length} work area{workAreas.length > 1 ? 's' : ''} &middot; {totalItems} line items
            {exportSuccess === 'qc' && newItemsCount > 0 && (
              <span className="block mt-1 text-blue-600">
                {newItemsCount} new item{newItemsCount > 1 ? 's' : ''} added to your catalog — set prices in QuickCalc.
              </span>
            )}
            {exportSuccess === 'excel' && (
              <span className="block mt-1 text-slate-400">
                Cost column blank — fill in QuickCalc.
              </span>
            )}
          </p>
          <div className="flex justify-center gap-3">
            {exportSuccess === 'qc' && (
              <a
                href="https://bluequickcalc.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
              >
                Open BlueQuickCalc
                <ExternalLink size={14} />
              </a>
            )}
            <button
              onClick={() => setExportSuccess(null)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Back to Estimate
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ProgressIndicator currentStep={3} />

      <div className="space-y-4">
        {/* Customer Info */}
        <div ref={customerRef}>
          <CustomerInfoSection
            info={customerInfo}
            onChange={onCustomerInfoChange}
            expanded={customerExpanded}
            onToggle={() => setCustomerExpanded(!customerExpanded)}
            missingFields={missingFields}
          />
        </div>

        {/* Work Area Cards */}
        {workAreas.map(wa => (
          <WorkAreaSection
            key={wa.id}
            workArea={wa}
            items={lineItems.get(wa.id) ?? []}
            catalogItems={catalogItems}
            onUpdateScope={scope => onUpdateScope(wa.id, scope)}
            onAddItem={(name, qty, unit, category) => {
              onAddItem(wa.id, {
                work_area_id: wa.id,
                name,
                qty,
                unit,
                category,
                catalog_item_id: null,
                match_status: 'new' as V2MatchStatus,
                source: 'user_added',
                original_name: name,
              })
            }}
            onUpdateItem={onUpdateItem}
            onRemoveItem={id => onRemoveItem(id, wa.id)}
          />
        ))}

        {/* Estimate Summary */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
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
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
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

        {/* Send error */}
        {sendError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">Jamie hit a snag — {sendError}. Try again.</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Findings
        </button>

        <div className="flex-1" />

        <button
          onClick={handleExcel}
          disabled={exporting || totalItems === 0}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Export to Excel
        </button>

        <button
          onClick={handleSend}
          disabled={sending || totalItems === 0}
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
  )
}
