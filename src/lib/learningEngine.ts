// Jamie Layer 4 — Learning Engine
// Detects edits to Jamie's suggestions, learns patterns, applies them to future estimates

import { supabase } from '@/lib/supabase'
import type { LineItemData } from '@/lib/types'
import { findInstallationEntry, evaluateFormula } from '@/lib/installationKnowledge'
import type { ComponentFormula, ClarifyingQuestion } from '@/lib/installationKnowledge'

// ── Types ──

export interface InstallationPattern {
  id: string
  user_id: string
  trigger_item: string
  trigger_unit: string | null
  learned_components: LearnedComponent[]
  confidence: number
  source: string
  last_updated: string
}

export interface LearnedComponent {
  name: string
  quantity_ratio: number // quantity relative to trigger item qty (e.g. 0.5 = half)
  unit: string
  category: string
}

export interface EditRecord {
  trigger_item: string
  action: 'added' | 'removed' | 'quantity_changed'
  item_name: string
  old_value: number | null
  new_value: number | null
}

export type LearningChoice = 'always' | 'confirm' | 'job_specific'

// ── Detect Edits ──

export function detectEdits(
  originalItems: LineItemData[],
  editedItems: LineItemData[],
  triggerItem: string,
): EditRecord[] {
  const edits: EditRecord[] = []

  // Find added items (in edited but not original)
  for (const edited of editedItems) {
    const original = originalItems.find((o) => o.id === edited.id)
    if (!original) {
      edits.push({
        trigger_item: triggerItem,
        action: 'added',
        item_name: edited.name,
        old_value: null,
        new_value: edited.quantity,
      })
    } else if (original.quantity !== edited.quantity) {
      edits.push({
        trigger_item: triggerItem,
        action: 'quantity_changed',
        item_name: edited.name,
        old_value: original.quantity,
        new_value: edited.quantity,
      })
    }
  }

  // Find removed items (in original but not edited)
  for (const original of originalItems) {
    if (!editedItems.find((e) => e.id === original.id)) {
      edits.push({
        trigger_item: triggerItem,
        action: 'removed',
        item_name: original.name,
        old_value: original.quantity,
        new_value: null,
      })
    }
  }

  return edits
}

// ── Save Edit History ──

export async function saveEditHistory(
  userId: string,
  estimateId: string,
  workAreaId: string,
  edits: EditRecord[],
) {
  if (edits.length === 0) return

  const rows = edits.map((edit) => ({
    user_id: userId,
    estimate_id: estimateId,
    work_area_id: workAreaId,
    trigger_item: edit.trigger_item,
    action: edit.action,
    item_name: edit.item_name,
    old_value: edit.old_value,
    new_value: edit.new_value,
  }))

  await supabase.from('bidclaw_edit_history').insert(rows)
}

// ── Save / Update Installation Pattern ──

export async function savePattern(
  userId: string,
  triggerItem: string,
  triggerUnit: string | null,
  components: LearnedComponent[],
  choice: LearningChoice,
) {
  if (choice === 'job_specific') return // Don't save pattern

  const confidenceBoost = choice === 'always' ? 2 : 1

  // Check if pattern already exists
  const { data: existing } = await supabase
    .from('bidclaw_installation_patterns')
    .select('*')
    .eq('user_id', userId)
    .eq('trigger_item', triggerItem.toLowerCase())
    .single()

  if (existing) {
    // Update existing pattern
    await supabase
      .from('bidclaw_installation_patterns')
      .update({
        learned_components: components,
        confidence: Math.min((existing.confidence ?? 0) + confidenceBoost, 5),
        last_updated: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    // Create new pattern
    await supabase.from('bidclaw_installation_patterns').insert({
      user_id: userId,
      trigger_item: triggerItem.toLowerCase(),
      trigger_unit: triggerUnit,
      learned_components: components,
      confidence: confidenceBoost,
      source: 'user_edit',
    })
  }
}

// ── Get Patterns for User ──

export async function getUserPatterns(userId: string): Promise<InstallationPattern[]> {
  const { data } = await supabase
    .from('bidclaw_installation_patterns')
    .select('*')
    .eq('user_id', userId)
    .order('last_updated', { ascending: false })

  return (data ?? []) as InstallationPattern[]
}

// ── Delete Pattern ──

export async function deletePattern(patternId: string) {
  await supabase.from('bidclaw_installation_patterns').delete().eq('id', patternId)
}

// ── Apply Patterns to Work Area (Priority System) ──

export interface AppliedComponent {
  name: string
  quantity: number
  unit: string
  category: string
  source: 'company_standard' | 'company_suggestion' | 'industry_standard' | 'web_research'
  badge: string
}

export interface ClarifyingPrompt {
  question: string
  options: Array<{ label: string; components?: string[]; qty_multiplier?: number }>
}

export interface PatternResult {
  components: AppliedComponent[]
  clarifying_question: ClarifyingPrompt | null
}

export async function applyPatterns(
  userId: string,
  triggerItem: string,
  quantity: number,
  workAreaNotes?: string,
): Promise<PatternResult> {
  // Priority 1 & 2: Check company-specific patterns
  const { data: patterns } = await supabase
    .from('bidclaw_installation_patterns')
    .select('*')
    .eq('user_id', userId)
    .eq('trigger_item', triggerItem.toLowerCase())
    .order('confidence', { ascending: false })
    .limit(1)

  const pattern = patterns?.[0] as InstallationPattern | undefined

  if (pattern) {
    const components: AppliedComponent[] = (pattern.learned_components ?? []).map((lc: LearnedComponent) => ({
      name: lc.name,
      quantity: Math.round(quantity * lc.quantity_ratio * 100) / 100,
      unit: lc.unit,
      category: lc.category,
      source: pattern.confidence >= 3 ? 'company_standard' as const : 'company_suggestion' as const,
      badge: pattern.confidence >= 3 ? '' : 'Based on your previous estimates',
    }))

    return { components, clarifying_question: null }
  }

  // Priority 3: Check built-in installation knowledge (Layer 1)
  const entry = findInstallationEntry(triggerItem)
  if (entry) {
    // Check if the clarifying question is already answered by work area notes
    let applicableComponents = entry.entry.components
    let clarifyingQ: ClarifyingPrompt | null = null

    if (entry.entry.clarifying_question) {
      const answered = checkIfAnsweredByNotes(entry.entry.clarifying_question, workAreaNotes)
      if (answered) {
        // Auto-apply the matching components
        applicableComponents = filterComponentsByAnswer(entry.entry.components, answered, entry.entry.clarifying_question)
      } else {
        clarifyingQ = entry.entry.clarifying_question
      }
    }

    const components: AppliedComponent[] = applicableComponents.map((c: ComponentFormula) => ({
      name: c.item,
      quantity: evaluateFormula(c.qty_formula, quantity),
      unit: c.unit,
      category: c.category ?? 'materials',
      source: 'industry_standard' as const,
      badge: 'Industry standard',
    }))

    return { components, clarifying_question: clarifyingQ }
  }

  // Priority 4 & 5: No pattern found — return empty (Layer 2 web research can be triggered separately)
  return { components: [], clarifying_question: null }
}

// ── Helpers ──

function checkIfAnsweredByNotes(
  question: ClarifyingQuestion,
  notes?: string,
): string | null {
  if (!notes) return null
  const lower = notes.toLowerCase()

  for (const option of question.options) {
    const label = option.label.toLowerCase()
    if (lower.includes(label)) return option.label
  }
  return null
}

function filterComponentsByAnswer(
  allComponents: ComponentFormula[],
  answerLabel: string,
  question: ClarifyingQuestion,
): ComponentFormula[] {
  const option = question.options.find((o) => o.label === answerLabel)
  if (!option?.components) return allComponents

  // Return only components that match the selected option
  return allComponents.filter((c) => option.components!.includes(c.item))
}
