import { supabase } from '@/lib/supabase'
import type { CatalogItem, AiLineItem } from '@/lib/types'

export interface CatalogMatchResult {
  catalogItem: CatalogItem
  matchType: 'matched' | 'fuzzy_matched' | 'new_created'
}

export async function matchOrCreateCatalogItem(
  aiItem: AiLineItem,
  userCatalog: CatalogItem[],
  userId: string
): Promise<CatalogMatchResult> {
  // 1. Exact name match (case-insensitive)
  const exactMatch = userCatalog.find(
    (c) => c.name.toLowerCase() === aiItem.name.toLowerCase()
  )
  if (exactMatch) return { catalogItem: exactMatch, matchType: 'matched' }

  // 2. Fuzzy match (substring check on first 6 chars)
  const searchTerm = aiItem.name.toLowerCase().substring(0, 6)
  const fuzzyMatch = userCatalog.find(
    (c) => c.name.toLowerCase().includes(searchTerm)
  )
  if (fuzzyMatch) return { catalogItem: fuzzyMatch, matchType: 'fuzzy_matched' }

  // 3. No match — create new catalog item
  const categoryToType: Record<string, string> = {
    Materials: 'material',
    Labor: 'labor',
    Equipment: 'equipment',
    Subcontractor: 'subcontractor',
    Disposal: 'other',
  }

  const { data: newItem, error } = await supabase
    .from('kyn_catalog_items')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      name: aiItem.name,
      type: categoryToType[aiItem.category] ?? 'other',
      unit_cost: null,
      needs_pricing: true,
      source: 'bidclaw_auto',
    })
    .select()
    .single()

  if (error || !newItem) {
    throw new Error(`Failed to create catalog item: ${error?.message}`)
  }

  return { catalogItem: newItem as CatalogItem, matchType: 'new_created' }
}

export async function matchAllLineItems(
  lineItems: AiLineItem[],
  userCatalog: CatalogItem[],
  userId: string
): Promise<Map<string, CatalogMatchResult>> {
  const results = new Map<string, CatalogMatchResult>()
  // Keep growing catalog as we create new items
  const catalog = [...userCatalog]

  for (const item of lineItems) {
    const result = await matchOrCreateCatalogItem(item, catalog, userId)
    results.set(item.id, result)
    if (result.matchType === 'new_created') {
      catalog.push(result.catalogItem)
    }
  }

  return results
}
