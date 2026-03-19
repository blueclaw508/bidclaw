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
  AiPass2Response,
} from '@/lib/types'
import { runPass1, runPass2 } from '@/lib/anthropic'
import { matchAllLineItems } from '@/lib/catalogMatcher'

export function useEstimate(estimateId: string | null) {
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
      if (error) { toast.error('Failed to load estimate'); setLoading(false); return }
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
    if (error) { toast.error(error.message); return null }
    return row.id
  }, [user])

  const uploadFiles = useCallback(async (files: File[]): Promise<string[]> => {
    if (!user) return []
    const urls: string[] = []
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = user.id + '/' + crypto.randomUUID() + '.' + ext
      const { error } = await supabase.storage.from('plans').upload(path, file)
      if (error) { toast.error('Upload failed: ' + file.name); continue }
      const { data } = supabase.storage.from('plans').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }, [user])

  const runAiPass1 = useCallback(async (): Promise<WorkAreaData[] | null> => {
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
      updateEstimate({ work_areas: workAreas, workflow_step: 2, approval_status: 'draft' })
      return workAreas
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed')
      return null
    } finally {
      setAiLoading(false)
      setAiMessage('')
    }
  }, [estimate, updateEstimate])

  const runAiPass2 = useCallback(async (
    approvedWorkAreas: WorkAreaData[]
  ): Promise<Record<string, LineItemData[]> | null> => {
    if (!estimate || !user) return null
    setAiLoading(true)
    setAiMessage('Analyzing work areas...')
    try {
      const { data: catalog } = await supabase
        .from('kyn_catalog_items').select('*').eq('user_id', user.id)
      const userCatalog = (catalog ?? []) as CatalogItem[]
      setAiMessage('Building line items...')
      const result: AiPass2Response = await runPass2(
        approvedWorkAreas.map((wa) => ({ id: wa.id, name: wa.name, description: wa.description })),
        estimate.project_description ?? '',
        userCatalog
      )
      setAiMessage('Matching items to your catalog...')
      const allItems = result.work_areas.flatMap((wa) => wa.line_items)
      const matchResults = await matchAllLineItems(allItems, userCatalog, user.id)
      const lineItems: Record<string, LineItemData[]> = {}
      const newCatalogItems: string[] = []
      for (const wa of result.work_areas) {
        lineItems[wa.id] = wa.line_items.map((li) => {
          const match = matchResults.get(li.id)
          if (match?.matchType === 'new_created') newCatalogItems.push(match.catalogItem.id)
          return { ...li, catalog_match_type: match?.matchType, catalog_item_id: match?.catalogItem.id }
        })
      }
      setAiMessage('Estimate ready for review')
      await new Promise((r) => setTimeout(r, 500))
      updateEstimate({
        line_items: lineItems, new_catalog_items_created: newCatalogItems,
        workflow_step: 3, approval_status: 'work_areas_approved',
      })
      return lineItems
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Line item generation failed')
      return null
    } finally {
      setAiLoading(false)
      setAiMessage('')
    }
  }, [estimate, user, updateEstimate])

  const sendToQuickCalc = useCallback(async (): Promise<boolean> => {
    if (!estimate) return false
    try {
      await supabase.from('estimates')
        .update({ approval_status: 'sent', sent_to_quickcalc_at: new Date().toISOString() })
        .eq('id', estimate.id)
      setEstimate((prev) => prev ? {
        ...prev, approval_status: 'sent', sent_to_quickcalc_at: new Date().toISOString(),
      } : prev)
      toast.success('Estimate sent to QuickCalc!')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
      return false
    }
  }, [estimate])

  return {
    estimate, loading, saving, aiLoading, aiMessage,
    updateEstimate, createEstimate, uploadFiles,
    runAiPass1, runAiPass2, sendToQuickCalc,
  }
}
