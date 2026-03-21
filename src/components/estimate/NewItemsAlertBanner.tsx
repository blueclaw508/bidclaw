import { useState } from 'react'
import { AlertTriangle, Check, DollarSign, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface NewItemsAlertBannerProps {
  count: number
  items: { name: string; unit: string; category: string; catalogItemId?: string }[]
  expanded?: boolean
  onPricesSaved?: () => void
}

export function NewItemsAlertBanner({
  count,
  items,
  expanded: initialExpanded = false,
  onPricesSaved,
}: NewItemsAlertBannerProps) {
  const [expanded, setExpanded] = useState(initialExpanded || count > 0)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (count === 0) return null

  const handlePriceChange = (itemName: string, value: string) => {
    setPrices((prev) => ({ ...prev, [itemName]: value }))
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      for (const item of items) {
        const price = parseFloat(prices[item.name] || '')
        if (!isNaN(price) && price > 0 && item.catalogItemId) {
          await supabase
            .from('kyn_catalog_items')
            .update({ unit_cost: price, needs_pricing: false })
            .eq('id', item.catalogItemId)
        }
      }
      setSaved(true)
      onPricesSaved?.()
    } catch {
      // silently fail — user can still set prices later
    } finally {
      setSaving(false)
    }
  }

  const pricedCount = items.filter((item) => {
    const p = parseFloat(prices[item.name] || '')
    return !isNaN(p) && p > 0
  }).length

  if (saved) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Check size={16} className="text-green-600" />
          <p className="text-sm font-semibold text-green-800">
            Prices saved to your catalog!
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-yellow-100">
          <AlertTriangle size={16} className="text-yellow-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-yellow-800">
            Jamie added {count} new item{count !== 1 ? 's' : ''} not in your catalog yet
          </p>
          <p className="text-xs text-yellow-600">
            Set your prices now so the estimate is ready to send.
          </p>
        </div>
      </button>

      {expanded && items.length > 0 && (
        <div className="border-t border-yellow-200 px-4 py-3">
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg bg-white border border-yellow-100 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.category} &middot; {item.unit}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <DollarSign size={14} className="text-slate-400" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={prices[item.name] || ''}
                    onChange={(e) => handlePriceChange(item.name, e.target.value)}
                    className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-right focus:border-[#1e40af] focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">/{item.unit}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSaveAll}
            disabled={saving || pricedCount === 0}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1e40af] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e3a8a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check size={14} />
                Save {pricedCount > 0 ? `${pricedCount} ` : ''}Price{pricedCount !== 1 ? 's' : ''} to Catalog
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
