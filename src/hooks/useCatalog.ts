import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { CatalogItem } from '@/lib/types'

export function useCatalog() {
  const { user } = useAuth()
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('kyn_catalog_items')
      .select('*')
      .eq('user_id', user.id)
      .order('name')
    setItems((data ?? []) as CatalogItem[])
    setLoading(false)
  }, [user])

  useEffect(() => { fetchItems() }, [fetchItems])

  const addItem = async (item: Partial<CatalogItem>) => {
    if (!user) return { data: null, error: { message: 'Not logged in' } }
    const { data, error } = await supabase
      .from('kyn_catalog_items')
      .insert({ ...item, user_id: user.id, source: 'manual', needs_pricing: false })
      .select()
      .single()
    if (!error && data) setItems((prev) => [...prev, data as CatalogItem])
    return { data, error }
  }

  const updateItem = async (id: string, updates: Partial<CatalogItem>) => {
    const { error } = await supabase.from('kyn_catalog_items').update(updates).eq('id', id)
    if (!error) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)))
    return { error }
  }

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from('kyn_catalog_items').delete().eq('id', id)
    if (!error) setItems((prev) => prev.filter((i) => i.id !== id))
    return { error }
  }

  const needsPricingCount = items.filter((i) => i.needs_pricing).length

  return { items, loading, addItem, updateItem, deleteItem, fetchItems, needsPricingCount }
}
