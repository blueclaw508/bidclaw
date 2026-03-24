// NewItemsAlertBanner — Simple info banner for new catalog items
// No pricing — BidClaw handles quantities only.

import { Package } from 'lucide-react'

interface NewItemsAlertBannerProps {
  count: number
  items: { name: string; unit: string; category: string; catalogItemId?: string }[]
  expanded?: boolean
  onPricesSaved?: () => void
}

export function NewItemsAlertBanner({
  count,
  items,
}: NewItemsAlertBannerProps) {
  if (count === 0) return null

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Package size={16} className="text-blue-600" />
        <p className="text-sm font-semibold text-blue-800">
          Jamie added {count} new item{count !== 1 ? 's' : ''} to your catalog
        </p>
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-700">
              {item.name}
              <span className="text-blue-400">{item.unit}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
