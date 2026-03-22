// NewCatalogItemPrompt — Inline card for new catalog items not yet priced
// Shows within the estimate view for each new item Jamie created.

import { useState } from 'react'
import { Save, Loader2, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

interface NewCatalogItemPromptProps {
  catalogItemId: string
  itemName: string
  itemType: string // 'material' | 'labor' | 'equipment' | 'subcontractor' | 'other'
  onPriceSaved: (catalogItemId: string, price: number) => void
}

export function NewCatalogItemPrompt({
  catalogItemId,
  itemName,
  itemType,
  onPriceSaved,
}: NewCatalogItemPromptProps) {
  const { user } = useAuth()
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const priceField = itemType === 'subcontractor' ? 'sub_cost'
    : itemType === 'other' ? 'default_amount'
    : 'unit_cost'

  const handleSave = async () => {
    if (!user || !price.trim()) return
    setSaving(true)

    const numPrice = parseFloat(price)
    if (isNaN(numPrice) || numPrice < 0) {
      setSaving(false)
      return
    }

    await supabase
      .from('kyn_catalog_items')
      .update({
        [priceField]: numPrice,
        needs_pricing: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', catalogItemId)

    setSaving(false)
    setSaved(true)
    onPriceSaved(catalogItemId, numPrice)
  }

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
        <Package size={14} />
        <span className="font-medium">{itemName}</span> — ${parseFloat(price).toFixed(2)} saved to catalog
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <img
        src="/jamie-avatar.png"
        alt="Jamie"
        className="mt-0.5 h-8 w-8 rounded-full object-cover flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700">
          I added <span className="font-semibold">{itemName}</span> but it's not in your catalog yet.
          What do you typically pay for this? I'll save it for next time.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1 max-w-[160px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-slate-300 bg-white pl-6 pr-2 py-1.5 text-sm outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !price.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save to Catalog
          </button>
        </div>
      </div>
    </div>
  )
}
