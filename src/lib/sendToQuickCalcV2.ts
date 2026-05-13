// ============================================================
// V2 Send to QuickCalc — Builds kyn_estimates payload from
// relational tables. BidClaw sends ZERO cost/price data.
// Catalog matching: hard link → exact name+type → exact name → create new.
// ============================================================

import { supabase } from '@/lib/supabase'
import type {
  V2Estimate,
  V2WorkArea,
  V2LineItem,
  CatalogItem,
} from '@/lib/types'

// Map V2 categories to QC catalog types
const CATEGORY_TO_TYPE: Record<string, string> = {
  Materials: 'material',
  Labor: 'labor',
  Equipment: 'equipment',
  Subcontractor: 'subcontractor',
  Other: 'other',
}

interface QCLineItem {
  id: string
  catalogItemId: string
  catalogItemType: string
  catalogItemName: string
  quantity: number
  rate: number | null
  amount: number
  isAmountOverridden: boolean
  catalogMatchType: string
}

interface QCWorkArea {
  id: string
  name: string
  description: string
  enabled: boolean
  lineItems: QCLineItem[]
  laborSubtotal: number
  materialSubtotal: number
  subcontractorSubtotal: number
  equipmentSubtotal: number
  otherSubtotal: number
  total: number
}

export interface SendToQCResult {
  success: boolean
  estimateId?: string
  newCatalogItemsCount: number
  error?: string
}

/**
 * Send a V2 estimate to QuickCalc by writing to kyn_estimates table.
 * BidClaw provides quantities only — costs come from QC catalog.
 */
export async function sendToQuickCalcV2(
  estimate: V2Estimate,
  workAreas: V2WorkArea[],
  lineItemsMap: Map<string, V2LineItem[]>
): Promise<SendToQCResult> {
  const { data: session } = await supabase.auth.getSession()
  const userId = session.session?.user?.id
  if (!userId) return { success: false, newCatalogItemsCount: 0, error: 'Not authenticated' }

  // Fetch user's QC catalog and equipment rates
  const [catalogResult, settingsResult] = await Promise.all([
    supabase.from('kyn_catalog_items').select('*').eq('user_id', userId),
    supabase.from('kyn_user_settings').select('settings_data').eq('user_id', userId).single(),
  ])

  const userCatalog = (catalogResult.data ?? []) as CatalogItem[]
  const equipmentRates: Record<string, number> = {}

  // Build equipment rate map from settings
  const settingsData = settingsResult.data?.settings_data as Record<string, unknown> | null
  if (settingsData?.equipmentRates && Array.isArray(settingsData.equipmentRates)) {
    for (const er of settingsData.equipmentRates as { id: string; hourlyRate: number }[]) {
      equipmentRates[er.id] = er.hourlyRate
    }
  }

  let newCatalogItemsCount = 0
  const growingCatalog = [...userCatalog]

  // 3-layer catalog lookup
  function findCatalogItem(lineItem: V2LineItem): { item: CatalogItem; matchType: string } | null {
    // Layer 1: Hard link via catalog_item_id
    if (lineItem.catalog_item_id) {
      const match = growingCatalog.find(c => c.id === lineItem.catalog_item_id)
      if (match) return { item: match, matchType: 'matched' }
    }

    // Layer 2: Exact name + same type
    const qcType = CATEGORY_TO_TYPE[lineItem.category] ?? 'material'
    const exactTypeMatch = growingCatalog.find(
      c => c.name.toLowerCase() === lineItem.name.toLowerCase() && c.type === qcType
    )
    if (exactTypeMatch) return { item: exactTypeMatch, matchType: 'matched' }

    // Layer 3: Exact name, any type
    const exactNameMatch = growingCatalog.find(
      c => c.name.toLowerCase() === lineItem.name.toLowerCase()
    )
    if (exactNameMatch) return { item: exactNameMatch, matchType: 'matched' }

    return null
  }

  // Create new catalog item if no match found
  async function createCatalogItem(lineItem: V2LineItem): Promise<CatalogItem | null> {
    const qcType = CATEGORY_TO_TYPE[lineItem.category] ?? 'other'

    const { data: newItem, error } = await supabase
      .from('kyn_catalog_items')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        name: lineItem.name,
        type: qcType,
        unit_cost: null,
        needs_pricing: true,
        source: 'bidclaw_auto',
      })
      .select()
      .single()

    if (error || !newItem) {
      console.error(`[QC Send] Failed to create catalog item "${lineItem.name}":`, error?.message)
      return null
    }

    newCatalogItemsCount++
    growingCatalog.push(newItem as CatalogItem)
    return newItem as CatalogItem
  }

  // Build QC work areas
  const qcWorkAreas: QCWorkArea[] = []
  let grandLaborSubtotal = 0
  let grandMaterialSubtotal = 0
  let grandSubcontractorSubtotal = 0
  let grandEquipmentSubtotal = 0
  let grandOtherSubtotal = 0

  for (const wa of workAreas) {
    const items = lineItemsMap.get(wa.id) ?? []
    const qcItems: QCLineItem[] = []

    let waLaborSub = 0
    let waMaterialSub = 0
    let waSubcontractorSub = 0
    let waEquipmentSub = 0
    let waOtherSub = 0

    for (const li of items) {
      // Find or create catalog item
      let catalogMatch = findCatalogItem(li)
      if (!catalogMatch) {
        const newItem = await createCatalogItem(li)
        if (newItem) {
          catalogMatch = { item: newItem, matchType: 'new_created' }
        }
      }

      if (!catalogMatch) continue

      const ci = catalogMatch.item
      const qcType = ci.type

      // Determine rate — BidClaw does NOT set rates, just reads from catalog
      let rate: number | null = null
      if (qcType === 'labor') {
        rate = null // QC applies its own retail labor rate
      } else if (qcType === 'material') {
        rate = ci.unit_cost ?? 0
      } else if (qcType === 'subcontractor') {
        rate = ci.sub_cost ?? 0
      } else if (qcType === 'equipment') {
        rate = ci.equipment_rate_id ? (equipmentRates[ci.equipment_rate_id] ?? 0) : 0
      } else {
        rate = ci.default_amount ?? 0
      }

      const amount = rate !== null ? li.qty * rate : 0

      // Accumulate subtotals
      if (qcType === 'labor') waLaborSub += amount
      else if (qcType === 'material') waMaterialSub += amount
      else if (qcType === 'subcontractor') waSubcontractorSub += amount
      else if (qcType === 'equipment') waEquipmentSub += amount
      else waOtherSub += amount

      qcItems.push({
        id: crypto.randomUUID(),
        catalogItemId: ci.id,
        catalogItemType: qcType,
        catalogItemName: ci.name,
        quantity: li.qty,
        rate,
        amount,
        isAmountOverridden: false,
        catalogMatchType: catalogMatch.matchType,
      })
    }

    grandLaborSubtotal += waLaborSub
    grandMaterialSubtotal += waMaterialSub
    grandSubcontractorSubtotal += waSubcontractorSub
    grandEquipmentSubtotal += waEquipmentSub
    grandOtherSubtotal += waOtherSub

    qcWorkAreas.push({
      id: wa.id,
      name: wa.name,
      description: wa.scope_description ?? '',
      enabled: true,
      lineItems: qcItems,
      laborSubtotal: waLaborSub,
      materialSubtotal: waMaterialSub,
      subcontractorSubtotal: waSubcontractorSub,
      equipmentSubtotal: waEquipmentSub,
      otherSubtotal: waOtherSub,
      total: waLaborSub + waMaterialSub + waSubcontractorSub + waEquipmentSub + waOtherSub,
    })
  }

  const grandTotal = grandLaborSubtotal + grandMaterialSubtotal +
    grandSubcontractorSubtotal + grandEquipmentSubtotal + grandOtherSubtotal

  // Build the kyn_estimates payload
  const fullName = [estimate.first_name, estimate.last_name].filter(Boolean).join(' ')
  const companyStr = estimate.company_name ? ` — ${estimate.company_name}` : ''

  const qcEstimateId = crypto.randomUUID()
  const now = new Date().toISOString()

  const payload = {
    id: qcEstimateId,
    user_id: userId,
    name: estimate.estimate_name || `${fullName} Estimate`,
    client_name: `${fullName}${companyStr}`,
    client_job_address_line1: [
      estimate.address_line,
      estimate.city,
      [estimate.state, estimate.zip].filter(Boolean).join(' '),
    ].filter(Boolean).join(', '),
    project_description: estimate.project_description ?? '',

    work_areas: qcWorkAreas,
    line_items: [],  // Schema compat — work area line items are nested

    labor_subtotal: grandLaborSubtotal,
    material_subtotal: grandMaterialSubtotal,
    subcontractor_subtotal: grandSubcontractorSubtotal,
    equipment_subtotal: grandEquipmentSubtotal,
    other_subtotal: grandOtherSubtotal,
    grand_total: grandTotal,
    is_calculated: true,

    payment_terms: [],
    terms_and_conditions: '',
    bottom_images: [],

    created_at: now,
    updated_at: now,
    status: 'Draft',
  }

  // Insert into kyn_estimates
  const { error: insertError } = await supabase
    .from('kyn_estimates')
    .insert(payload)

  if (insertError) {
    console.error('[QC Send] Insert failed:', insertError.message)
    return { success: false, newCatalogItemsCount, error: insertError.message }
  }

  // Update BidClaw estimate status
  await supabase
    .from('estimates')
    .update({ status: 'sent', updated_at: now })
    .eq('id', estimate.id)

  console.log(`[QC Send] Estimate sent to QuickCalc. ID: ${qcEstimateId}, New items: ${newCatalogItemsCount}`)

  return {
    success: true,
    estimateId: qcEstimateId,
    newCatalogItemsCount,
  }
}
