// ============================================================
// V2 Estimate Hook — Relational Schema
// Works with the new estimates columns + work_areas, line_items,
// measurements tables. Old JSONB columns are not written to.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { runPass1V2, type Pass1V2Input } from '@/lib/pass1V2'
import { runPass2V2, type Pass2V2WorkAreaInput, type Pass2V2Result, type Pass2V2Progress } from '@/lib/pass2V2'
import type {
  V2Estimate,
  V2EstimateStatus,
  V2PlanFile,
  V2Pass1Extraction,
  V2Pass1Confidence,
  V2WorkArea,
  V2LineItem,
  V2Measurement,
  V2MeasurementShape,
  CatalogItem,
  ProductionRate,
} from '@/lib/types'

// Columns the hook is allowed to write to on the estimates table
const SAFE_COLUMNS = new Set([
  'first_name', 'last_name', 'company_name', 'phone', 'email',
  'estimate_name', 'address_line', 'city', 'state', 'zip',
  'project_type', 'project_description',
  'plans', 'pass1_extraction', 'pass1_confidence', 'pass1_completed_at',
  'status', 'updated_at',
])

export interface UseEstimateV2Return {
  // State
  estimate: V2Estimate | null
  workAreas: V2WorkArea[]
  lineItems: Map<string, V2LineItem[]>  // keyed by work_area_id
  loading: boolean
  saving: boolean
  pass1Loading: boolean
  pass1Error: string | null
  pass2Loading: boolean
  pass2Error: string | null
  pass2Progress: Pass2V2Progress | null
  notFound: boolean

  // Actions
  createEstimate: () => Promise<string | null>
  updateEstimate: (updates: Partial<V2Estimate>, immediate?: boolean) => void
  uploadPlan: (file: File) => Promise<V2PlanFile | null>
  removePlan: (index: number) => void
  runPass1: () => Promise<V2Pass1Extraction | null>

  // Work area actions (used in Step 2+)
  addWorkArea: (name: string) => Promise<V2WorkArea | null>
  removeWorkArea: (id: string) => Promise<void>
  reorderWorkAreas: (ids: string[]) => Promise<void>
  updateWorkAreaScope: (id: string, scope: string) => Promise<void>

  // Pass 2 actions
  runPass2: () => Promise<Pass2V2Result[] | null>
  reEstimateWorkArea: (workAreaId: string, gapAnswers: { question: string; answer: string }[]) => Promise<Pass2V2Result | null>

  // Line item CRUD (Step 3)
  addLineItem: (workAreaId: string, item: Omit<V2LineItem, 'id' | 'created_at' | 'estimate_id' | 'sort_order'>) => Promise<V2LineItem | null>
  updateLineItem: (id: string, updates: Partial<V2LineItem>) => Promise<void>
  removeLineItem: (id: string, workAreaId: string) => Promise<void>

  // Measurement actions
  measurements: V2Measurement[]
  saveMeasurement: (meas: {
    name: string; shape: V2MeasurementShape
    area_sf?: number; linear_ft?: number; length_ft?: number; width_ft?: number
    vertices: { x: number; y: number }[]; scale_ppi?: number
    plan_index?: number; work_area_id?: string
  }) => Promise<V2Measurement | null>
  deleteMeasurement: (id: string) => Promise<void>
  associateMeasurementWithWorkArea: (measurementId: string, workAreaId: string | null) => Promise<void>

  // Export actions (Step 4)
  sendToQuickCalc: () => Promise<{ success: boolean; newItemsCount: number; error?: string }>
  exportToExcel: () => Promise<void>
}

export function useEstimateV2(
  estimateId?: string,
  onPass1Error?: (error: string) => void
): UseEstimateV2Return {
  const [estimate, setEstimate] = useState<V2Estimate | null>(null)
  const [workAreas, setWorkAreas] = useState<V2WorkArea[]>([])
  const [lineItems, setLineItems] = useState<Map<string, V2LineItem[]>>(new Map())
  const [measurements, setMeasurements] = useState<V2Measurement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pass1Loading, setPass1Loading] = useState(false)
  const [pass1Error, setPass1Error] = useState<string | null>(null)
  const [pass2Loading, setPass2Loading] = useState(false)
  const [pass2Error, setPass2Error] = useState<string | null>(null)
  const [pass2Progress, setPass2Progress] = useState<Pass2V2Progress | null>(null)
  const [notFound, setNotFound] = useState(false)

  // Ref that always holds the latest estimate — avoids stale closures
  // when uploadPlan + runPass1 are called in the same async callback
  const estimateRef = useRef<V2Estimate | null>(null)

  // Wrapper that keeps ref and state in sync.
  // IMPORTANT: ref must be updated EAGERLY (synchronously) so that
  // subsequent calls in the same async callback (e.g. uploadPlan → runPass1)
  // see the latest value. React 18 defers setState updater functions,
  // so updating the ref inside setState would be too late.
  const setEstimateAndRef = useCallback((updater: V2Estimate | null | ((prev: V2Estimate | null) => V2Estimate | null)) => {
    if (typeof updater === 'function') {
      const next = updater(estimateRef.current)
      estimateRef.current = next
      setEstimate(next)
    } else {
      estimateRef.current = updater
      setEstimate(updater)
    }
  }, [])

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load estimate on mount ──
  useEffect(() => {
    // Reset state for new estimate ID (prevents stale notFound from blocking navigation)
    setNotFound(false)
    setLoading(true)

    if (!estimateId) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('estimates')
        .select('*')
        .eq('id', estimateId)
        .single()

      if (cancelled) return

      if (error || !data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setEstimateAndRef(data as V2Estimate)

      // Load work areas, line items, and measurements in parallel
      const [waResult, liResult, measResult] = await Promise.all([
        supabase.from('work_areas').select('*').eq('estimate_id', estimateId).order('sort_order'),
        supabase.from('line_items').select('*').eq('estimate_id', estimateId).order('sort_order'),
        supabase.from('measurements').select('*').eq('estimate_id', estimateId).order('created_at'),
      ])

      if (cancelled) return

      if (waResult.data) {
        setWorkAreas(waResult.data as V2WorkArea[])
      }

      if (liResult.data) {
        const itemMap = new Map<string, V2LineItem[]>()
        for (const item of liResult.data as V2LineItem[]) {
          const existing = itemMap.get(item.work_area_id) ?? []
          existing.push(item)
          itemMap.set(item.work_area_id, existing)
        }
        setLineItems(itemMap)
      }

      if (measResult.data) {
        setMeasurements(measResult.data as V2Measurement[])
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [estimateId])

  // ── Save to Supabase ──
  const saveToDb = useCallback(async (updates: Partial<V2Estimate>) => {
    if (!estimate?.id) return

    // Filter to safe columns only
    const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const [key, value] of Object.entries(updates)) {
      if (SAFE_COLUMNS.has(key)) {
        safeUpdates[key] = value
      }
    }

    setSaving(true)
    const { error } = await supabase
      .from('estimates')
      .update(safeUpdates)
      .eq('id', estimate.id)

    setSaving(false)

    if (error) {
      console.error('[useEstimateV2] Save failed:', error.message)
    }
  }, [estimate?.id])

  // ── Update estimate (debounced or immediate) ──
  const updateEstimate = useCallback((updates: Partial<V2Estimate>, immediate?: boolean) => {
    setEstimateAndRef(prev => prev ? { ...prev, ...updates } : prev)

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)

    if (immediate) {
      saveToDb(updates)
    } else {
      autoSaveTimer.current = setTimeout(() => saveToDb(updates), 500)
    }
  }, [saveToDb])

  // ── Create new estimate ──
  const createEstimate = useCallback(async (): Promise<string | null> => {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user?.id
    if (!userId) {
      console.error('[useEstimateV2] No user ID in session — cannot create estimate')
      return null
    }

    console.log('[useEstimateV2] Creating estimate for user:', userId)

    // Insert with only original-schema columns to avoid PostgREST cache issues.
    // V2 columns (first_name, address_line, status, etc.) have DB defaults
    // and will be set via updateEstimate after the record is loaded.
    const { data, error } = await supabase
      .from('estimates')
      .insert({
        user_id: userId,
        workflow_step: 1,
        approval_status: 'draft',
        plan_file_urls: [],
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[useEstimateV2] Create failed:', error?.message, error?.details, error?.code)
      return null
    }

    console.log('[useEstimateV2] Created estimate:', data.id)

    return data.id
  }, [])

  // ── Upload plan file to Supabase storage ──
  const uploadPlan = useCallback(async (file: File): Promise<V2PlanFile | null> => {
    const est = estimateRef.current
    if (!est?.id) return null

    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user?.id
    if (!userId) return null

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('plans')
      .upload(storagePath, file)

    if (uploadError) {
      console.error('[useEstimateV2] Upload failed:', uploadError.message)
      return null
    }

    const { data: urlData } = supabase.storage.from('plans').getPublicUrl(storagePath)

    // Determine page count for PDFs
    let pageCount = 1
    if (ext === 'pdf') {
      try {
        const { default: pdfjsLib } = await import('pdfjs-dist')
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        pageCount = pdf.numPages
        pdf.destroy()
      } catch {
        console.warn('[useEstimateV2] Could not count PDF pages')
      }
    }

    const planFile: V2PlanFile = {
      file_path: urlData.publicUrl,
      file_name: file.name,
      page_count: pageCount,
      rasterized_pages: [],  // Populated during Pass 1
      uploaded_at: new Date().toISOString(),
    }

    // Add to plans array and save — use ref for latest plans
    const currentPlans = estimateRef.current?.plans ?? []
    const updatedPlans = [...currentPlans, planFile]
    updateEstimate({ plans: updatedPlans } as Partial<V2Estimate>, true)

    // Also save to plan_file_urls (legacy column, always in schema cache)
    // so plan data persists even if PostgREST cache is stale for 'plans'
    const urls = updatedPlans.map(p => p.file_path)
    await supabase
      .from('estimates')
      .update({ plan_file_urls: urls })
      .eq('id', est.id)

    return planFile
  }, [updateEstimate])  // estimateRef.current used instead of estimate

  // ── Remove plan file ──
  const removePlan = useCallback((index: number) => {
    if (!estimate?.plans) return
    const updatedPlans = estimate.plans.filter((_, i) => i !== index)
    updateEstimate({ plans: updatedPlans } as Partial<V2Estimate>, true)
  }, [estimate, updateEstimate])

  // ── Run Pass 1 ──
  const runPass1 = useCallback(async (): Promise<V2Pass1Extraction | null> => {
    // Use ref to get the LATEST estimate state (avoids stale closure
    // when uploadPlan + runPass1 are called in the same async callback)
    const est = estimateRef.current
    if (!est) return null

    setPass1Loading(true)
    setPass1Error(null)

    try {
      const input: Pass1V2Input = {
        estimateName: est.estimate_name,
        firstName: est.first_name,
        lastName: est.last_name,
        addressLine: est.address_line,
        city: est.city,
        state: est.state,
        zip: est.zip,
        projectType: est.project_type,
        projectDescription: est.project_description,
        plans: (est.plans ?? []).map(p => ({
          file_path: p.file_path,
          file_name: p.file_name,
        })),
      }

      const result = await runPass1V2(input)

      // Store result in database
      updateEstimate({
        pass1_extraction: result.extraction,
        pass1_confidence: result.confidence as V2Pass1Confidence,
        pass1_completed_at: new Date().toISOString(),
        status: 'pass1_complete' as V2EstimateStatus,
      } as Partial<V2Estimate>, true)

      setPass1Loading(false)
      return result.extraction
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Jamie could not read the plans'
      setPass1Error(msg)
      setPass1Loading(false)
      onPass1Error?.(msg)
      return null
    }
  }, [updateEstimate, onPass1Error])  // estimateRef.current used instead of estimate

  // ── Work area management ──
  const addWorkArea = useCallback(async (name: string): Promise<V2WorkArea | null> => {
    if (!estimate?.id) return null

    const sortOrder = workAreas.length

    const { data, error } = await supabase
      .from('work_areas')
      .insert({
        estimate_id: estimate.id,
        name,
        sort_order: sortOrder,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('[useEstimateV2] Add work area failed:', error?.message)
      return null
    }

    const wa = data as V2WorkArea
    setWorkAreas(prev => [...prev, wa])
    return wa
  }, [estimate?.id, workAreas.length])

  const removeWorkArea = useCallback(async (id: string) => {
    const { error } = await supabase.from('work_areas').delete().eq('id', id)
    if (!error) {
      setWorkAreas(prev => prev.filter(wa => wa.id !== id))
    }
  }, [])

  const reorderWorkAreas = useCallback(async (ids: string[]) => {
    // Update sort_order for each work area
    const updates = ids.map((id, index) =>
      supabase.from('work_areas').update({ sort_order: index }).eq('id', id)
    )
    await Promise.all(updates)

    setWorkAreas(prev => {
      const byId = new Map(prev.map(wa => [wa.id, wa]))
      return ids.map((id, index) => {
        const wa = byId.get(id)!
        return { ...wa, sort_order: index }
      })
    })
  }, [])

  // ── Fetch QC catalog + production rates ──
  const fetchCatalogAndRates = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user?.id
    if (!userId) return { catalog: [] as CatalogItem[], rates: [] as ProductionRate[] }

    const [catalogResult, ratesResult] = await Promise.all([
      supabase.from('kyn_catalog_items').select('*').eq('user_id', userId),
      supabase.from('production_rates').select('*').eq('user_id', userId),
    ])

    return {
      catalog: (catalogResult.data ?? []) as CatalogItem[],
      rates: (ratesResult.data ?? []) as ProductionRate[],
    }
  }, [])

  // ── Store Pass 2 results to relational tables ──
  const storePass2Results = useCallback(async (results: Pass2V2Result[]) => {
    if (!estimate?.id) return

    for (const result of results) {
      // Update work area with scope + Pass 2 output
      await supabase
        .from('work_areas')
        .update({
          scope_description: result.scopeDescription,
          pass2_mode: result.mode,
          pass2_raw: result.rawResponse,
          gap_questions: result.gapQuestions.length > 0
            ? result.gapQuestions.map(q => ({ question: q }))
            : null,
          pass2_completed_at: new Date().toISOString(),
        })
        .eq('id', result.workAreaId)

      // Delete existing line items for this work area (re-estimation)
      await supabase
        .from('line_items')
        .delete()
        .eq('work_area_id', result.workAreaId)

      // Insert new line items
      if (result.lineItems.length > 0) {
        const rows = result.lineItems.map((item, idx) => ({
          work_area_id: result.workAreaId,
          estimate_id: estimate.id,
          sort_order: idx,
          name: item.name,
          qty: item.qty,
          unit: item.unit,
          category: item.category,
          catalog_item_id: item.catalog_item_id || null,
          match_status: item.match_status || 'new',
          source: 'jamie' as const,
          original_name: item.name,
        }))

        const { data: inserted } = await supabase
          .from('line_items')
          .insert(rows)
          .select()

        if (inserted) {
          setLineItems(prev => {
            const updated = new Map(prev)
            updated.set(result.workAreaId, inserted as V2LineItem[])
            return updated
          })
        }
      }
    }

    // Reload work areas to get updated pass2 data
    const { data: updatedWAs } = await supabase
      .from('work_areas')
      .select('*')
      .eq('estimate_id', estimate.id)
      .order('sort_order')

    if (updatedWAs) {
      setWorkAreas(updatedWAs as V2WorkArea[])
    }
  }, [estimate?.id])

  // ── Run Pass 2 for all work areas ──
  const runPass2 = useCallback(async (): Promise<Pass2V2Result[] | null> => {
    if (!estimate || workAreas.length === 0) return null

    setPass2Loading(true)
    setPass2Error(null)
    setPass2Progress(null)

    try {
      // Fetch catalog and rates
      const { catalog, rates } = await fetchCatalogAndRates()

      // Build work area inputs
      const inputs: Pass2V2WorkAreaInput[] = workAreas.map(wa => ({
        id: wa.id,
        name: wa.name,
        estimateDescription: estimate.project_description,
        pass1Extraction: estimate.pass1_extraction,
        planFileUrls: (estimate.plans ?? []).map(p => p.file_path),
      }))

      // Update status
      updateEstimate({ status: 'estimating' as V2EstimateStatus } as Partial<V2Estimate>, true)

      // Run Pass 2 with progress
      const results = await runPass2V2(
        inputs,
        catalog,
        rates,
        undefined, // web search results map — search is done inside Pass 2 via tools
        (progress) => setPass2Progress(progress)
      )

      // Store results to database
      await storePass2Results(results)

      // Update estimate status
      updateEstimate({ status: 'review' as V2EstimateStatus } as Partial<V2Estimate>, true)

      setPass2Loading(false)
      setPass2Progress(null)
      return results
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Jamie could not complete the estimate'
      setPass2Error(msg)
      setPass2Loading(false)
      return null
    }
  }, [estimate, workAreas, fetchCatalogAndRates, storePass2Results, updateEstimate])

  // ── Re-estimate a single work area (after gap questions answered) ──
  const reEstimateWorkArea = useCallback(async (
    workAreaId: string,
    gapAnswers: { question: string; answer: string }[]
  ): Promise<Pass2V2Result | null> => {
    if (!estimate) return null

    const wa = workAreas.find(w => w.id === workAreaId)
    if (!wa) return null

    setPass2Loading(true)
    setPass2Error(null)

    try {
      const { catalog, rates } = await fetchCatalogAndRates()
      const { runPass2V2SingleWorkArea } = await import('@/lib/pass2V2')

      const input: Pass2V2WorkAreaInput = {
        id: wa.id,
        name: wa.name,
        estimateDescription: estimate.project_description,
        pass1Extraction: estimate.pass1_extraction,
        planFileUrls: (estimate.plans ?? []).map(p => p.file_path),
        gapAnswers,
      }

      const result = await runPass2V2SingleWorkArea(input, catalog, rates)

      // Store result
      await storePass2Results([result])

      setPass2Loading(false)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Jamie could not re-estimate "${wa.name}"`
      setPass2Error(msg)
      setPass2Loading(false)
      return null
    }
  }, [estimate, workAreas, fetchCatalogAndRates, storePass2Results])

  // ── Measurement CRUD ──
  const saveMeasurement = useCallback(async (meas: {
    name: string
    shape: V2MeasurementShape
    area_sf?: number
    linear_ft?: number
    length_ft?: number
    width_ft?: number
    vertices: { x: number; y: number }[]
    scale_ppi?: number
    plan_index?: number
    work_area_id?: string
  }): Promise<V2Measurement | null> => {
    if (!estimate?.id) return null

    const { data, error } = await supabase
      .from('measurements')
      .insert({
        estimate_id: estimate.id,
        work_area_id: meas.work_area_id || null,
        plan_index: meas.plan_index ?? 0,
        name: meas.name,
        shape: meas.shape,
        area_sf: meas.area_sf ?? null,
        linear_ft: meas.linear_ft ?? null,
        length_ft: meas.length_ft ?? null,
        width_ft: meas.width_ft ?? null,
        vertices: meas.vertices,
        scale_ppi: meas.scale_ppi ?? null,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('[useEstimateV2] Save measurement failed:', error?.message)
      return null
    }

    const saved = data as V2Measurement
    setMeasurements(prev => [...prev, saved])
    return saved
  }, [estimate?.id])

  const deleteMeasurement = useCallback(async (id: string) => {
    const { error } = await supabase.from('measurements').delete().eq('id', id)
    if (!error) {
      setMeasurements(prev => prev.filter(m => m.id !== id))
    }
  }, [])

  const associateMeasurementWithWorkArea = useCallback(async (
    measurementId: string,
    workAreaId: string | null
  ) => {
    await supabase
      .from('measurements')
      .update({ work_area_id: workAreaId })
      .eq('id', measurementId)

    setMeasurements(prev => prev.map(m =>
      m.id === measurementId ? { ...m, work_area_id: workAreaId } : m
    ))

    // Auto-populate line item quantities if associating
    if (workAreaId) {
      const meas = measurements.find(m => m.id === measurementId)
      if (!meas) return

      const waItems = lineItems.get(workAreaId) ?? []
      // Find area-based or linear-based items to update
      if (meas.area_sf && meas.area_sf > 0) {
        // Update first area-based material item that matches
        const areaItem = waItems.find(li =>
          li.category === 'Materials' && ['SF', 'SY'].includes(li.unit)
        )
        if (areaItem) {
          const newQty = meas.area_sf * (areaItem.unit === 'SY' ? 1 / 9 : 1)
          await supabase.from('line_items').update({ qty: newQty }).eq('id', areaItem.id)
          setLineItems(prev => {
            const updated = new Map(prev)
            const items = [...(updated.get(workAreaId) ?? [])]
            const idx = items.findIndex(li => li.id === areaItem.id)
            if (idx !== -1) items[idx] = { ...items[idx], qty: newQty }
            updated.set(workAreaId, items)
            return updated
          })
        }
      }
      if (meas.linear_ft && meas.linear_ft > 0) {
        const linearItem = waItems.find(li =>
          li.category === 'Materials' && li.unit === 'LF'
        )
        if (linearItem) {
          await supabase.from('line_items').update({ qty: meas.linear_ft }).eq('id', linearItem.id)
          setLineItems(prev => {
            const updated = new Map(prev)
            const items = [...(updated.get(workAreaId) ?? [])]
            const idx = items.findIndex(li => li.id === linearItem.id)
            if (idx !== -1) items[idx] = { ...items[idx], qty: meas.linear_ft! }
            updated.set(workAreaId, items)
            return updated
          })
        }
      }
    }
  }, [measurements, lineItems])

  // ── Update work area scope description ──
  const updateWorkAreaScope = useCallback(async (id: string, scope: string) => {
    await supabase.from('work_areas').update({ scope_description: scope }).eq('id', id)
    setWorkAreas(prev => prev.map(wa =>
      wa.id === id ? { ...wa, scope_description: scope } : wa
    ))
  }, [])

  // ── Line item CRUD ──
  const addLineItem = useCallback(async (
    workAreaId: string,
    item: Omit<V2LineItem, 'id' | 'created_at' | 'estimate_id' | 'sort_order'>
  ): Promise<V2LineItem | null> => {
    if (!estimate?.id) return null

    const currentItems = lineItems.get(workAreaId) ?? []
    const sortOrder = currentItems.length

    const { data, error } = await supabase
      .from('line_items')
      .insert({
        work_area_id: workAreaId,
        estimate_id: estimate.id,
        sort_order: sortOrder,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        category: item.category,
        catalog_item_id: item.catalog_item_id || null,
        match_status: item.match_status || 'new',
        source: item.source || 'user_added',
        original_name: item.original_name || item.name,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('[useEstimateV2] Add line item failed:', error?.message)
      return null
    }

    const newItem = data as V2LineItem
    setLineItems(prev => {
      const updated = new Map(prev)
      const existing = updated.get(workAreaId) ?? []
      updated.set(workAreaId, [...existing, newItem])
      return updated
    })
    return newItem
  }, [estimate?.id, lineItems])

  const updateLineItem = useCallback(async (id: string, updates: Partial<V2LineItem>) => {
    // Build safe update — strip fields we don't want to write
    const safeUpdates: Record<string, unknown> = {}
    const allowedFields = ['name', 'qty', 'unit', 'category', 'catalog_item_id', 'match_status', 'source', 'sort_order']
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value
      }
    }

    // If name changed and it was Jamie's item, track as user_edited
    if (safeUpdates.name && !safeUpdates.source) {
      safeUpdates.source = 'user_edited'
    }

    const { error } = await supabase.from('line_items').update(safeUpdates).eq('id', id)
    if (error) {
      console.error('[useEstimateV2] Update line item failed:', error.message)
      return
    }

    setLineItems(prev => {
      const updated = new Map(prev)
      for (const [waId, items] of updated) {
        const idx = items.findIndex(li => li.id === id)
        if (idx !== -1) {
          const updatedItems = [...items]
          updatedItems[idx] = { ...updatedItems[idx], ...updates }
          updated.set(waId, updatedItems)
          break
        }
      }
      return updated
    })
  }, [])

  const removeLineItem = useCallback(async (id: string, workAreaId: string) => {
    const { error } = await supabase.from('line_items').delete().eq('id', id)
    if (!error) {
      setLineItems(prev => {
        const updated = new Map(prev)
        const existing = updated.get(workAreaId) ?? []
        updated.set(workAreaId, existing.filter(li => li.id !== id))
        return updated
      })
    }
  }, [])

  // ── Send to QuickCalc ──
  const sendToQuickCalc = useCallback(async () => {
    if (!estimate) return { success: false, newItemsCount: 0, error: 'No estimate' }

    try {
      const { sendToQuickCalcV2 } = await import('@/lib/sendToQuickCalcV2')
      const result = await sendToQuickCalcV2(estimate, workAreas, lineItems)

      if (result.success) {
        setEstimateAndRef(prev => prev ? { ...prev, status: 'sent' as V2EstimateStatus } : prev)
      }

      return {
        success: result.success,
        newItemsCount: result.newCatalogItemsCount,
        error: result.error,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send to QuickCalc'
      return { success: false, newItemsCount: 0, error: msg }
    }
  }, [estimate, workAreas, lineItems])

  // ── Export to Excel ──
  const exportToExcel = useCallback(async () => {
    if (!estimate) return

    const { exportEstimateToExcelV2 } = await import('@/lib/exportExcelV2')
    await exportEstimateToExcelV2(estimate, workAreas, lineItems)

    // Update status
    updateEstimate({ status: 'exported' as V2EstimateStatus } as Partial<V2Estimate>, true)
  }, [estimate, workAreas, lineItems, updateEstimate])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [])

  return {
    estimate,
    workAreas,
    lineItems,
    loading,
    saving,
    pass1Loading,
    pass1Error,
    pass2Loading,
    pass2Error,
    pass2Progress,
    notFound,
    createEstimate,
    updateEstimate,
    uploadPlan,
    removePlan,
    runPass1,
    addWorkArea,
    removeWorkArea,
    reorderWorkAreas,
    updateWorkAreaScope,
    runPass2,
    reEstimateWorkArea,
    addLineItem,
    updateLineItem,
    removeLineItem,
    measurements,
    saveMeasurement,
    deleteMeasurement,
    associateMeasurementWithWorkArea,
    sendToQuickCalc,
    exportToExcel,
  }
}
