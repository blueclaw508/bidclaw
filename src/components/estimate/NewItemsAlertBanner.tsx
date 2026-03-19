import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

interface NewItemsAlertBannerProps {
  count: number
  items: { name: string; unit: string; category: string }[]
  expanded?: boolean
}

export function NewItemsAlertBanner({
  count,
  items,
  expanded: initialExpanded = false,
}: NewItemsAlertBannerProps) {
  const [expanded, setExpanded] = useState(initialExpanded)

  if (count === 0) return null

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
            BidClaw created {count} new catalog item{count !== 1 ? 's' : ''} that
            {count === 1 ? " doesn't" : " don't"} have prices yet
          </p>
          <p className="text-xs text-yellow-600">
            You can set prices in QuickCalc after sending this estimate.
          </p>
        </div>
        <div className="flex-shrink-0 text-yellow-600">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {expanded && items.length > 0 && (
        <div className="border-t border-yellow-200 px-4 py-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-yellow-200">
                  <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-yellow-700">
                    Item Name
                  </th>
                  <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-yellow-700">
                    Unit
                  </th>
                  <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-yellow-700">
                    Category
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-yellow-100 last:border-b-0">
                    <td className="py-2 pr-4 text-sm text-yellow-900">{item.name}</td>
                    <td className="py-2 pr-4 text-sm text-yellow-700">{item.unit}</td>
                    <td className="py-2 text-sm text-yellow-700">{item.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
