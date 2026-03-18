import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { Sparkles, X, Check } from 'lucide-react'

export interface EditDiff {
  field: string // e.g. "Mulch Install quantity"
  itemName: string // e.g. "Dark Bark Mulch"
  oldValue: number
  newValue: number
  unit: string
  // What to update if accepted
  updateType: 'production_rate' | 'material_cost'
  updateKey: string // work_type or material name
  updateField: string // man_hours_per_unit or unit_cost
}

interface LearningPromptProps {
  diffs: EditDiff[]
  onDismiss: () => void
}

export function LearningPrompt({ diffs, onDismiss }: LearningPromptProps) {
  const { company } = useAuth()
  const [processing, setProcessing] = useState<Record<number, boolean>>({})
  const [handled, setHandled] = useState<Record<number, 'saved' | 'skipped'>>({})

  if (diffs.length === 0) return null

  const allHandled = diffs.every((_, i) => handled[i])

  const saveToProfile = async (diff: EditDiff, index: number) => {
    if (!company) return
    setProcessing((prev) => ({ ...prev, [index]: true }))

    try {
      if (diff.updateType === 'production_rate') {
        // Check if rate exists
        const { data: existing } = await supabase
          .from('production_rates')
          .select('id')
          .eq('company_id', company.id)
          .ilike('work_type', diff.updateKey)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('production_rates')
            .update({ [diff.updateField]: diff.newValue })
            .eq('id', existing.id)
        } else {
          await supabase.from('production_rates').insert({
            company_id: company.id,
            work_type: diff.updateKey,
            unit: diff.unit,
            man_hours_per_unit: diff.newValue,
            notes: `Updated from estimate edit`,
          })
        }
        toast.success(`Production rate updated: ${diff.updateKey}`)
      } else if (diff.updateType === 'material_cost') {
        const { data: existing } = await supabase
          .from('materials_catalog')
          .select('id')
          .eq('company_id', company.id)
          .ilike('name', diff.updateKey)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('materials_catalog')
            .update({ [diff.updateField]: diff.newValue })
            .eq('id', existing.id)
        } else {
          await supabase.from('materials_catalog').insert({
            company_id: company.id,
            name: diff.updateKey,
            unit: diff.unit,
            unit_cost: diff.newValue,
            notes: `Added from estimate edit`,
          })
        }
        toast.success(`Material cost updated: ${diff.updateKey}`)
      }

      setHandled((prev) => ({ ...prev, [index]: 'saved' }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setProcessing((prev) => ({ ...prev, [index]: false }))
    }
  }

  const skipDiff = (index: number) => {
    setHandled((prev) => ({ ...prev, [index]: 'skipped' }))
  }

  return (
    <div className="rounded-xl border-2 border-gold/40 bg-gold/5 p-5">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-gold-dark" />
          <h4 className="text-sm font-semibold text-navy">
            AI Noticed Your Edits
          </h4>
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-navy"
        >
          <X size={16} />
        </button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        You changed some AI-generated values. Should I update your company
        profile so future estimates use these numbers?
      </p>

      <div className="space-y-3">
        {diffs.map((diff, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${
              handled[i] === 'saved'
                ? 'border-green-200 bg-green-50'
                : handled[i] === 'skipped'
                ? 'border-border bg-muted/30 opacity-60'
                : 'border-border bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-navy">{diff.field}</p>
              <p className="text-xs text-muted-foreground">
                <span className="line-through text-destructive">
                  {diff.oldValue} {diff.unit}
                </span>
                {' → '}
                <span className="font-semibold text-green-700">
                  {diff.newValue} {diff.unit}
                </span>
              </p>
            </div>

            {handled[i] ? (
              <span className="text-xs font-medium text-muted-foreground">
                {handled[i] === 'saved' ? '✓ Saved' : 'Skipped'}
              </span>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => skipDiff(i)}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  Job-specific
                </button>
                <button
                  onClick={() => saveToProfile(diff, i)}
                  disabled={processing[i]}
                  className="inline-flex items-center gap-1 rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium text-white hover:bg-navy-light disabled:opacity-50"
                >
                  <Check size={12} />
                  {processing[i] ? 'Saving...' : 'Update Profile'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {allHandled && (
        <button
          onClick={onDismiss}
          className="mt-4 w-full rounded-lg bg-navy/5 py-2 text-xs font-medium text-navy hover:bg-navy/10"
        >
          Done — Continue
        </button>
      )}
    </div>
  )
}

/**
 * Compare original AI-generated line items with the current (edited) versions.
 * Returns diffs for items where the user changed quantity or unit_cost by >10%.
 */
export function detectLineItemEdits(
  originalItems: { name: string; quantity: number; unit: string; unit_cost: number | null }[],
  currentItems: { name: string; quantity: number; unit: string; unit_cost: number | null }[]
): EditDiff[] {
  const diffs: EditDiff[] = []

  for (const current of currentItems) {
    const original = originalItems.find(
      (o) => o.name.toLowerCase() === current.name.toLowerCase()
    )
    if (!original) continue

    // Check quantity change (>10% difference)
    if (
      original.quantity > 0 &&
      current.quantity > 0 &&
      Math.abs(current.quantity - original.quantity) / original.quantity > 0.1
    ) {
      diffs.push({
        field: `${current.name} — quantity`,
        itemName: current.name,
        oldValue: original.quantity,
        newValue: current.quantity,
        unit: current.unit,
        updateType: 'production_rate',
        updateKey: current.name,
        updateField: 'man_hours_per_unit',
      })
    }

    // Check unit cost change (>10% difference)
    if (
      original.unit_cost != null &&
      current.unit_cost != null &&
      original.unit_cost > 0 &&
      current.unit_cost > 0 &&
      Math.abs(current.unit_cost - original.unit_cost) / original.unit_cost > 0.1
    ) {
      diffs.push({
        field: `${current.name} — unit cost`,
        itemName: current.name,
        oldValue: original.unit_cost,
        newValue: current.unit_cost,
        unit: '$',
        updateType: 'material_cost',
        updateKey: current.name,
        updateField: 'unit_cost',
      })
    }
  }

  return diffs
}
