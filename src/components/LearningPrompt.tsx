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
  updateType: 'production_rate'
  updateKey: string // work_type
  updateField: string // man_hours_per_unit
}

interface LearningPromptProps {
  diffs: EditDiff[]
  onDismiss: () => void
}

export function LearningPrompt({ diffs, onDismiss }: LearningPromptProps) {
  const { user } = useAuth()
  const [processing, setProcessing] = useState<Record<number, boolean>>({})
  const [handled, setHandled] = useState<Record<number, 'saved' | 'skipped'>>({})

  if (diffs.length === 0) return null

  const allHandled = diffs.every((_, i) => handled[i])

  const saveToProfile = async (diff: EditDiff, index: number) => {
    if (!user) return
    setProcessing((prev) => ({ ...prev, [index]: true }))

    try {
      // Check if rate exists
      const { data: existing } = await supabase
        .from('bidclaw_production_rates')
        .select('id')
        .eq('user_id', user.id)
        .ilike('work_type', diff.updateKey)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('bidclaw_production_rates')
          .update({ [diff.updateField]: diff.newValue })
          .eq('id', existing.id)
      } else {
        await supabase.from('bidclaw_production_rates').insert({
          user_id: user.id,
          work_type: diff.updateKey,
          unit: diff.unit,
          man_hours_per_unit: diff.newValue,
          notes: `Updated from estimate edit`,
        })
      }
      toast.success(`Production rate updated: ${diff.updateKey}`)

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
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-blue-700" />
          <h4 className="text-sm font-semibold text-blue-900">
            AI Noticed Your Edits
          </h4>
        </div>
        <button onClick={onDismiss} className="text-slate-500 hover:text-blue-900">
          <X size={16} />
        </button>
      </div>

      <p className="mb-4 text-xs text-slate-500">
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
                ? 'border-slate-200 bg-slate-50 opacity-60'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-blue-900">{diff.field}</p>
              <p className="text-xs text-slate-500">
                <span className="line-through text-red-600">
                  {diff.oldValue} {diff.unit}
                </span>
                {' → '}
                <span className="font-semibold text-green-700">
                  {diff.newValue} {diff.unit}
                </span>
              </p>
            </div>

            {handled[i] ? (
              <span className="text-xs font-medium text-slate-500">
                {handled[i] === 'saved' ? '✓ Saved' : 'Skipped'}
              </span>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => skipDiff(i)}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  Job-specific
                </button>
                <button
                  onClick={() => saveToProfile(diff, i)}
                  disabled={processing[i]}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}
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
          className="mt-4 w-full rounded-lg bg-blue-50 py-2 text-xs font-medium text-blue-900 hover:bg-blue-100"
        >
          Done — Continue
        </button>
      )}
    </div>
  )
}

/**
 * Compare original AI-generated line items with the current (edited) versions.
 * Returns diffs for items where the user changed quantity by >10%.
 * BidClaw tracks quantities only — no cost comparisons.
 */
export function detectLineItemEdits(
  originalItems: { name: string; quantity: number; unit: string }[],
  currentItems: { name: string; quantity: number; unit: string }[]
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
  }

  return diffs
}
