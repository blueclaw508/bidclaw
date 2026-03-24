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
import type { ProductionRate } from '@/lib/types'

export function useEstimate(estimateId: string | null, onJamieError?: (msg: string, retry?: () => void) => void) {
  const { user } = useAuth()
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  // True after we fetched and the estimate was not found in DB (real 404)
  const [notFound, setNotFound] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<Partial<EstimateRecord> | null>(null)

  // Use user.id as dependency (stable string) instead of the user object
  // to prevent re-fetches when Supabase returns a new object reference
  const userId = user?.id
  useEffect(() => {
    setNotFound(false)
    if (!estimateId || !userId) { setLoading(false); return }
    setLoading(true)
    const load = async () => {
      const { data, error } = await supabase
        .from('estimates')
        .select('*')
        .eq('id', estimateId)
        .single()
      if (error) {
        toast.error('Jamie hit a snag — couldn\'t load this estimate. Try refreshing the page.')
        setNotFound(true)
        setLoading(false)
        return
      }
      setEstimate(data as EstimateRecord)
      setLoading(false)
    }
    load()
  }, [estimateId, userId])

  // Immediate save — no debounce. Use for critical data (work areas, line items, workflow step).
  const immediateSave = useCallback(async (updates: Partial<EstimateRecord>) => {
    if (!estimateId) return
    setSaving(true)
    await supabase.from('estimates').update(updates).eq('id', estimateId)
    setSaving(false)
  }, [estimateId])

  // Debounced save — accumulates all updates within the 500ms window so rapid
  // field changes never overwrite each other.
  const autoSave = useCallback(async (updates: Partial<EstimateRecord>) => {
    if (!estimateId) return
    pendingSaveRef.current = { ...(pendingSaveRef.current ?? {}), ...updates }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const accumulated = pendingSaveRef.current
      if (!accumulated) return
      pendingSaveRef.current = null
      setSaving(true)
      await supabase.from('estimates').update(accumulated).eq('id', estimateId)
      setSaving(false)
    }, 500)
  }, [estimateId])

  // Flush any pending debounced save immediately when the user switches tabs
  // OR navigates away from this estimate (estimateId changes / component unmounts).
  const flushPendingSave = useCallback(() => {
    if (pendingSaveRef.current && estimateId) {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      const data = pendingSaveRef.current
      pendingSaveRef.current = null
      supabase.from('estimates').update(data).eq('id', estimateId)
    }
  }, [estimateId])

  useEffect(() => {
    const flush = () => { if (document.hidden) flushPendingSave() }
    document.addEventListener('visibilitychange', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      // Flush on unmount or estimateId change (user navigated away)
      flushPendingSave()
    }
  }, [flushPendingSave])

  // Update React state + save to Supabase. immediate=true bypasses debounce.
  const updateEstimate = useCallback((updates: Partial<EstimateRecord>, immediate = false) => {
    setEstimate((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...updates }
      if (immediate) immediateSave(updates)
      else autoSave(updates)
      return next
    })
  }, [autoSave, immediateSave])

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
      updateEstimate({ work_areas: workAreas, gap_questions: gapQuestions, workflow_step: 2, approval_status: 'draft' }, true)
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
      // Fetch catalog and production rates in parallel
      const [{ data: catalog }, { data: ratesData }] = await Promise.all([
        supabase.from('kyn_catalog_items').select('*').eq('user_id', user.id),
        supabase.from('production_rates').select('*').eq('user_id', user.id),
      ])
      const userCatalog = (catalog ?? []) as CatalogItem[]
      const productionRates = (ratesData ?? []) as ProductionRate[]

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

      // Transition to Step 3 immediately so the user sees progress — save immediately
      updateEstimate({
        line_items: lineItems,
        scope_descriptions: scopeDescriptions,
        gap_questions: gapQuestions,
        new_catalog_items_created: newCatalogItems,
        workflow_step: 3,
        approval_status: 'work_areas_approved',
      }, true)

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

          // Incrementally update estimate so completed work areas render immediately — save immediately
          updateEstimate({
            line_items: { ...lineItems },
            scope_descriptions: { ...scopeDescriptions },
            gap_questions: { ...gapQuestions },
            new_catalog_items_created: [...newCatalogItems],
          }, true)
        }
      }

      setAiMessage(`Jamie is working on ${waList[0]?.name ?? 'work areas'}... (0 of ${waList.length} complete)`)

      // Run Pass2 per work area with progress callbacks
      await runPass2(
        waList,
        estimate.project_description ?? '',
        userCatalog,
        productionRates,
        gapAnswers,
        searchContext,
        handleProgress,
        manualMode
      )

      setAiMessage('Estimate ready for review')
      await new Promise((r) => setTimeout(r, 500))

      // Final update with all results — save immediately
      updateEstimate({
        line_items: lineItems,
        scope_descriptions: scopeDescriptions,
        gap_questions: gapQuestions,
        new_catalog_items_created: newCatalogItems,
      }, true)

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

      // ── Fetch user's existing QC catalog ──
      const { data: existingCatalog } = await supabase
        .from('kyn_catalog_items').select('*').eq('user_id', user.id)

      // Mutable catalog list so newly-created items are visible to later lookups
      const catalogItems: any[] = existingCatalog ?? []
      // ID index for direct hard-link via catalog_item_id already on line item
      const catalogById = new Map<string, any>()
      for (const item of catalogItems) {
        catalogById.set(item.id, item)
      }

      // ── Normalize helper: lowercase, trim, strip trailing 's' ──
      function normalizeName(s: string): string {
        return s.toLowerCase().trim().replace(/s$/, '')
      }

      // ── 5-layer catalog lookup (never re-creates if a match exists) ──
      function findInCatalog(
        existingId: string | undefined,
        name: string,
        qcType: string,
      ): any | null {
        // Layer 1: hard link via catalog_item_id set during estimate build
        if (existingId) {
          const hit = catalogById.get(existingId)
          if (hit) return hit
        }
        const nameLower = name.toLowerCase().trim()
        // Layer 2: exact name + same type
        const exactSameType = catalogItems.find(
          (c) => c.name.toLowerCase().trim() === nameLower && c.type === qcType
        )
        if (exactSameType) return exactSameType
        // Layer 3: exact name, any type
        const exactAnyType = catalogItems.find(
          (c) => c.name.toLowerCase().trim() === nameLower
        )
        if (exactAnyType) return exactAnyType
        // Layer 4: normalized match (strip trailing 's')
        const nameNorm = normalizeName(name)
        if (nameNorm.length >= 3) {
          const normMatch = catalogItems.find((c) => normalizeName(c.name) === nameNorm)
          if (normMatch) return normMatch
        }
        // Layer 5: substring match in either direction (min 4 chars to avoid noise)
        if (nameNorm.length >= 4) {
          const subMatch = catalogItems.find((c) => {
            const cn = normalizeName(c.name)
            return cn.length >= 4 && (cn.includes(nameNorm) || nameNorm.includes(cn))
          })
          if (subMatch) return subMatch
        }
        return null
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
          let catalogItem = findInCatalog(li.catalog_item_id, li.name, qcType)
          let catalogMatchType: 'matched' | 'new_created' = 'matched'

          // No match found — create new catalog item flagged for pricing
          // unit_cost intentionally null: pricing lives in QC catalog, never from AI
          if (!catalogItem) {
            catalogMatchType = 'new_created'
            const newId = crypto.randomUUID()
            const newItem: any = {
              id: newId,
              user_id: user.id,
              type: qcType,
              name: li.name,
              labor_type_id: null,
              unit_cost: null,
              equipment_rate_id: null,
              sub_cost: null,
              default_amount: null,
              needs_pricing: true,
              source: 'bidclaw_auto',
            }
            await supabase.from('kyn_catalog_items').insert(newItem)
            catalogItem = newItem
            catalogById.set(newId, newItem)
            catalogItems.push(newItem)
            newCatalogItems.push({ id: newId, name: li.name, type: qcType })
          }

          // Rate: null for labor (QuickCalc applies its own retail labor rate).
          // Other categories use catalog pricing from QC's own catalog.
          let rate: number | null = null
          if (qcType === 'labor') rate = null  // QuickCalc must apply its stored retail labor rate
          else if (qcType === 'material') rate = catalogItem.unit_cost ?? 0
          else if (qcType === 'subcontractor') rate = catalogItem.sub_cost ?? 0
          else if (qcType === 'equipment') rate = catalogItem.unit_cost ?? 0
          else if (qcType === 'other') rate = catalogItem.default_amount ?? 0

          const amount = rate != null ? li.quantity * rate : 0

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
            catalogMatchType,
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
          description: (estimate.scope_descriptions?.[wa.id]) || wa.description || '',
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

      // ── Build structured name and address for QuickCalc ──
      const fullName = [estimate.first_name, estimate.last_name].filter(Boolean).join(' ') || estimate.client_name || ''
      const qcEstimateName = estimate.estimate_name || (fullName ? `BidClaw — ${fullName}` : `BidClaw Estimate — ${new Date().toLocaleDateString()}`)

      // ── Insert into kyn_estimates ──
      const { error: insertError } = await supabase.from('kyn_estimates').insert({
        id: qcEstimateId,
        user_id: user.id,
        name: qcEstimateName,
        first_name: estimate.first_name || '',
        last_name: estimate.last_name || '',
        company_name: estimate.company_name || null,
        client_name: fullName,
        client_job_address_line1: estimate.address_line || '',
        client_job_city: estimate.city || '',
        client_job_state: estimate.state || '',
        client_job_zip: estimate.zip || '',
        client_email: estimate.email || '',
        client_phone: estimate.phone || '',
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
      const newCount = newCatalogItems.length
      if (newCount > 0) {
        toast.success(`Estimate sent to QuickCalc — ${newCount} new item${newCount !== 1 ? 's' : ''} need pricing in your catalog.`)
      } else {
        toast.success('Estimate sent to QuickCalc!')
      }
      return true
    } catch (err) {
      toast.error('Jamie hit a snag — couldn\'t send to QuickCalc. Try again.')
      return false
    }
  }, [estimate, user])

  return {
    estimate, loading, saving, aiLoading, aiMessage, notFound,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass1, runAiPass2, sendToQuickCalc,
  }
}
