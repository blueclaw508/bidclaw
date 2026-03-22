import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type {
  EstimateRecord,
  WorkAreaData,
  LineItemData,
  CatalogItem,
  AiPass1Response,
} from '@/lib/types'
import { runPass1, runPass2 } from '@/lib/anthropic'
import type { Pass2Progress } from '@/lib/anthropic'
import { matchAllLineItems } from '@/lib/catalogMatcher'
import { searchMaterialAssemblies, formatSearchResultsForPrompt } from '@/lib/webSearch'
import { KYN_RATE_DEFAULTS } from '@/lib/jamiePrompt'
import type { KYNRates } from '@/lib/jamiePrompt'
import type { ProductionRate } from '@/lib/types'

export function useEstimate(estimateId: string | null, onJamieError?: (msg: string, retry?: () => void) => void) {
  const { user } = useAuth()
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!estimateId || !user) { setLoading(false); return }
    const load = async () => {
      const { data, error } = await supabase
        .from('estimates')
        .select('*')
        .eq('id', estimateId)
        .single()
      if (error) { toast.error('Jamie hit a snag — couldn\'t load this estimate. Try refreshing the page.'); setLoading(false); return }
      setEstimate(data as EstimateRecord)
      setLoading(false)
    }
    load()
  }, [estimateId, user])

  const autoSave = useCallback(async (updates: Partial<EstimateRecord>) => {
    if (!estimateId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await supabase.from('estimates').update(updates).eq('id', estimateId)
      setSaving(false)
    }, 2000)
  }, [estimateId])

  const updateEstimate = useCallback((updates: Partial<EstimateRecord>) => {
    setEstimate((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...updates }
      autoSave(updates)
      return next
    })
  }, [autoSave])

  const createEstimate = useCallback(async (data: {
    client_name: string
    project_address: string
    project_description: string
    plan_file_urls: string[]
  }): Promise<string | null> => {
    if (!user) return null
    const { data: row, error } = await supabase
      .from('estimates')
      .insert({
        user_id: user.id,
        client_name: data.client_name,
        project_address: data.project_address,
        project_description: data.project_description,
        plan_file_urls: data.plan_file_urls,
        workflow_step: 1,
        approval_status: 'draft',
      })
      .select('id')
      .single()
    if (error) { toast.error('Jamie hit a snag — couldn\'t save the project. Try again.'); return null }
    return row.id
  }, [user])

  const uploadFiles = useCallback(async (files: File[]): Promise<string[]> => {
    if (!user) return []
    const urls: string[] = []
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = user.id + '/' + crypto.randomUUID() + '.' + ext
      const { error } = await supabase.storage.from('plans').upload(path, file)
      if (error) { toast.error('Jamie hit a snag — couldn\'t upload ' + file.name + '. Check the file and try again.'); continue }
      const { data } = supabase.storage.from('plans').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }, [user])

  const runAiPass1 = useCallback(async (): Promise<{ workAreas: WorkAreaData[]; gapQuestions: Record<string, string[]> } | null> => {
    if (!estimate) return null
    setAiLoading(true)
    setAiMessage('Reading your project plans...')
    try {
      await new Promise((r) => setTimeout(r, 1000))
      setAiMessage('Identifying work areas...')
      const result: AiPass1Response = await runPass1(
        estimate.client_name ?? '',
        estimate.project_address ?? '',
        estimate.project_description ?? '',
        estimate.plan_file_urls
      )
      setAiMessage('Work areas ready for review')
      await new Promise((r) => setTimeout(r, 500))
      const workAreas: WorkAreaData[] = result.work_areas.map((wa) => ({
        id: wa.id, name: wa.name, description: wa.description,
        complexity: wa.complexity, approved: false,
      }))
      // Extract gap questions from Pass1 response
      const gapQuestions: Record<string, string[]> = {}
      for (const wa of result.work_areas) {
        if (wa.gap_questions && wa.gap_questions.length > 0) {
          gapQuestions[wa.id] = wa.gap_questions
        }
      }
      updateEstimate({ work_areas: workAreas, gap_questions: gapQuestions, workflow_step: 2, approval_status: 'draft' })
      return { workAreas, gapQuestions }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Jamie analysis failed'
      if (onJamieError) onJamieError(msg, runAiPass1)
      else toast.error(msg)
      return null
    } finally {
      setAiLoading(false)
      setAiMessage('')
    }
  }, [estimate, updateEstimate, onJamieError])

  const runAiPass2 = useCallback(async (
    approvedWorkAreas: WorkAreaData[],
    gapAnswers?: Record<string, string>,
    manualMode?: boolean
  ): Promise<{ lineItems: Record<string, LineItemData[]>; scopeDescriptions: Record<string, string>; gapQuestions: Record<string, string[]> } | null> => {
    if (!estimate || !user) return null
    setAiLoading(true)
    setAiMessage('Analyzing work areas...')
    try {
      // Fetch catalog, production rates, and KYN rates in parallel
      const [{ data: catalog }, { data: ratesData }, { data: kynData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_kyn_rates').select('*').eq('user_id', user.id).maybeSingle(),
      ])
      const userCatalog = (catalog ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]
      const kynRates: KYNRates = kynData
        ? {
            retail_labor_rate: kynData.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate,
            material_markup: kynData.material_markup ?? KYN_RATE_DEFAULTS.material_markup,
            sub_markup: kynData.sub_markup ?? KYN_RATE_DEFAULTS.sub_markup,
            equipment_markup: kynData.equipment_markup ?? KYN_RATE_DEFAULTS.equipment_markup,
          }
        : { ...KYN_RATE_DEFAULTS }

      // Web Search Layer — fire material assembly searches
      setAiMessage('Researching material assemblies...')
      const waList = approvedWorkAreas.map((wa) => ({ id: wa.id, name: wa.name, description: wa.description }))
      const searchResults = await searchMaterialAssemblies(waList)
      const searchContext = formatSearchResultsForPrompt(searchResults, waList)

      // Accumulators for incremental results
      const lineItems: Record<string, LineItemData[]> = {}
      const scopeDescriptions: Record<string, string> = {}
      const gapQuestions: Record<string, string[]> = {}
      const newCatalogItems: string[] = []

      // Transition to Step 3 immediately so the user sees progress
      updateEstimate({
        line_items: lineItems,
        scope_descriptions: scopeDescriptions,
        gap_questions: gapQuestions,
        new_catalog_items_created: newCatalogItems,
        workflow_step: 3,
        approval_status: 'work_areas_approved',
      })

      // Progress callback — updates the loading message and incrementally adds each completed work area
      const handleProgress = async (progress: Pass2Progress) => {
        const { completedCount, totalCount, currentWorkAreaName, completedWorkArea } = progress
        setAiMessage(`Jamie is working on ${currentWorkAreaName}... (${completedCount} of ${totalCount} complete)`)

        if (completedWorkArea) {
          // Match this work area's line items to catalog
          const waItems = completedWorkArea.line_items ?? []
          const matchResults = await matchAllLineItems(waItems, userCatalog, user.id)

          if (completedWorkArea.scope_description) scopeDescriptions[completedWorkArea.id] = completedWorkArea.scope_description
          if (completedWorkArea.gap_questions) gapQuestions[completedWorkArea.id] = completedWorkArea.gap_questions

          lineItems[completedWorkArea.id] = waItems.map((li) => {
            const match = matchResults.get(li.id)
            if (match?.matchType === 'new_created') newCatalogItems.push(match.catalogItem.id)
            return { ...li, catalog_match_type: match?.matchType, catalog_item_id: match?.catalogItem.id }
          })

          // Incrementally update estimate so completed work areas render immediately
          updateEstimate({
            line_items: { ...lineItems },
            scope_descriptions: { ...scopeDescriptions },
            gap_questions: { ...gapQuestions },
            new_catalog_items_created: [...newCatalogItems],
          })
        }
      }

      setAiMessage(`Jamie is working on ${waList[0]?.name ?? 'work areas'}... (0 of ${waList.length} complete)`)

      // Run Pass2 per work area with progress callbacks
      await runPass2(
        waList,
        estimate.project_description ?? '',
        userCatalog,
        productionRates,
        kynRates,
        gapAnswers,
        searchContext,
        handleProgress,
        manualMode
      )

      setAiMessage('Estimate ready for review')
      await new Promise((r) => setTimeout(r, 500))

      // Final update with all results
      updateEstimate({
        line_items: lineItems,
        scope_descriptions: scopeDescriptions,
        gap_questions: gapQuestions,
        new_catalog_items_created: newCatalogItems,
      })

      return { lineItems, scopeDescriptions, gapQuestions }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Line item generation failed'
      if (onJamieError) onJamieError(msg)
      else toast.error(msg)
      return null
    } finally {
      setAiLoading(false)
      setAiMessage('')
    }
  }, [estimate, user, updateEstimate, onJamieError])

  const sendToQuickCalc = useCallback(async (): Promise<boolean> => {
    if (!estimate || !user) return false
    try {
      // ── Map BidClaw category to QC catalog type ──
      const categoryToType: Record<string, string> = {
        'Materials': 'material',
        'Labor': 'labor',
        'Equipment': 'equipment',
        'Subcontractor': 'subcontractor',
        'Disposal': 'other',
      }

      // ── Fetch user's existing QC catalog + KYN rates ──
      const [{ data: existingCatalog }, { data: kynData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('bidclaw_kyn_rates').select('*').eq('user_id', user.id).maybeSingle(),
      ])

      const retailLaborRate = kynData?.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate

      const catalogItems = existingCatalog ?? []
      const catalogByNameType = new Map<string, any>()
      for (const item of catalogItems) {
        catalogByNameType.set(`${(item.name || '').toLowerCase()}::${item.type}`, item)
      }

      const newCatalogItems: { id: string; name: string; type: string }[] = []
      const workAreas = estimate.work_areas ?? []
      const lineItemsByWa = estimate.line_items ?? {}

      // ── Build QC work areas with line items ──
      const qcWorkAreas = []
      let laborSubtotal = 0
      let materialSubtotal = 0
      let subcontractorSubtotal = 0
      let equipmentSubtotal = 0
      let otherSubtotal = 0

      for (let i = 0; i < workAreas.length; i++) {
        const wa = workAreas[i]
        const bcItems = lineItemsByWa[wa.id] ?? []
        const qcLineItems = []

        let waLabor = 0, waMaterial = 0, waSub = 0, waEquip = 0, waOther = 0

        for (const li of bcItems) {
          const qcType = categoryToType[li.category] || 'other'
          const lookupKey = `${li.name.toLowerCase()}::${qcType}`
          let catalogItem = catalogByNameType.get(lookupKey)

          // If not found, create new catalog item at $0
          if (!catalogItem) {
            const newId = crypto.randomUUID()
            const newItem = {
              id: newId,
              user_id: user.id,
              type: qcType,
              name: li.name,
              labor_type_id: null,
              unit_cost: qcType === 'material' ? 0 : null,
              equipment_rate_id: null,
              sub_cost: qcType === 'subcontractor' ? 0 : null,
              default_amount: qcType === 'other' ? 0 : null,
            }
            await supabase.from('kyn_catalog_items').insert(newItem)
            catalogItem = newItem
            catalogByNameType.set(lookupKey, newItem)
            newCatalogItems.push({ id: newId, name: li.name, type: qcType })
          }

          // Get rate from catalog item — labor uses the KYN retail labor rate
          let rate = 0
          if (qcType === 'labor') rate = retailLaborRate
          else if (qcType === 'material') rate = catalogItem.unit_cost ?? 0
          else if (qcType === 'subcontractor') rate = catalogItem.sub_cost ?? 0
          else if (qcType === 'equipment') rate = catalogItem.unit_cost ?? 0
          else if (qcType === 'other') rate = catalogItem.default_amount ?? 0

          const amount = li.quantity * rate

          // Track subtotals
          if (qcType === 'labor') waLabor += amount
          else if (qcType === 'material') waMaterial += amount
          else if (qcType === 'subcontractor') waSub += amount
          else if (qcType === 'equipment') waEquip += amount
          else waOther += amount

          qcLineItems.push({
            id: crypto.randomUUID(),
            catalogItemId: catalogItem.id,
            catalogItemType: qcType,
            catalogItemName: li.name,
            quantity: li.quantity,
            rate: rate,
            amount: amount,
            isAmountOverridden: false,
          })
        }

        laborSubtotal += waLabor
        materialSubtotal += waMaterial
        subcontractorSubtotal += waSub
        equipmentSubtotal += waEquip
        otherSubtotal += waOther

        qcWorkAreas.push({
          id: crypto.randomUUID(),
          name: wa.name,
          description: wa.description || '',
          enabled: true,
          lineItems: qcLineItems,
          laborSubtotal: waLabor,
          materialSubtotal: waMaterial,
          subcontractorSubtotal: waSub,
          equipmentSubtotal: waEquip,
          otherSubtotal: waOther,
          total: waLabor + waMaterial + waSub + waEquip + waOther,
        })
      }

      const grandTotal = laborSubtotal + materialSubtotal + subcontractorSubtotal + equipmentSubtotal + otherSubtotal
      const now = new Date().toISOString()
      const qcEstimateId = crypto.randomUUID()

      // ── Parse address into structured fields ──
      const addressParts = (estimate.project_address || '').split(',').map(s => s.trim())
      const addressLine1 = addressParts[0] || ''
      const city = addressParts[1] || ''
      const stateZip = (addressParts[2] || '').split(' ').filter(Boolean)
      const state = stateZip[0] || ''
      const zip = stateZip[1] || ''

      // ── Insert into kyn_estimates ──
      const { error: insertError } = await supabase.from('kyn_estimates').insert({
        id: qcEstimateId,
        user_id: user.id,
        name: estimate.client_name
          ? `BidClaw — ${estimate.client_name}`
          : `BidClaw Estimate — ${new Date().toLocaleDateString()}`,
        client_name: estimate.client_name || '',
        client_job_address_line1: addressLine1,
        client_job_city: city,
        client_job_state: state,
        client_job_zip: zip,
        client_email: '',
        client_phone: '',
        project_description: estimate.project_description || '',
        work_areas: qcWorkAreas,
        line_items: [],
        labor_subtotal: laborSubtotal,
        material_subtotal: materialSubtotal,
        subcontractor_subtotal: subcontractorSubtotal,
        equipment_subtotal: equipmentSubtotal,
        other_subtotal: otherSubtotal,
        grand_total: grandTotal,
        is_calculated: true,
        payment_terms: [],
        terms_and_conditions: '',
        bottom_images: [],
        created_at: now,
        updated_at: now,
        status: 'Draft',
      })

      if (insertError) throw new Error(insertError.message)

      // ── Mark BidClaw estimate as sent ──
      await supabase.from('estimates')
        .update({ approval_status: 'sent', sent_to_quickcalc_at: now })
        .eq('id', estimate.id)
      setEstimate((prev) => prev ? {
        ...prev, approval_status: 'sent', sent_to_quickcalc_at: now,
      } : prev)

      // ── Show result ──
      toast.success('Estimate sent to QuickCalc!')
      return true
    } catch (err) {
      toast.error('Jamie hit a snag — couldn\'t send to QuickCalc. Try again.')
      return false
    }
  }, [estimate, user])

  return {
    estimate, loading, saving, aiLoading, aiMessage,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass1, runAiPass2, sendToQuickCalc,
  }
}
