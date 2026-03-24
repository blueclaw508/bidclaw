// NewCatalogItemPrompt — Simple notification that Jamie added a new catalog item
// No pricing — BidClaw handles quantities only. Pricing lives in QuickCalc.

import { Package } from 'lucide-react'

interface NewCatalogItemPromptProps {
  itemName: string
}

export function NewCatalogItemPrompt({
  itemName,
}: NewCatalogItemPromptProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
      <Package size={14} />
      <span className="font-medium">{itemName}</span> — added to your catalog
    </div>
  )
}
