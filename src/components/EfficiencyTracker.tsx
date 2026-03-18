import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type { JobEfficiency } from '@/lib/types'
import { BarChart3, Check, X, TrendingUp, TrendingDown } from 'lucide-react'

interface EfficiencyTrackerProps {
  estimateId: string
  budgetedManHours: number
  jobName: string
  onClose: () => void
}

export function EfficiencyTracker({
  estimateId,
  budgetedManHours,
  jobName,
  onClose,
}: EfficiencyTrackerProps) {
  const { company } = useAuth()
  const [actualHours, setActualHours] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<JobEfficiency | null>(null)
  const [updateCompanyRate, setUpdateCompanyRate] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('job_efficiency')
        .select('*')
        .eq('estimate_id', estimateId)
        .maybeSingle()
      if (data) {
        setExisting(data)
        setActualHours(data.actual_man_hours ?? '')
        setNotes(data.notes ?? '')
      }
    }
    load()
  }, [estimateId])

  const efficiencyPercent =
    actualHours && Number(actualHours) > 0
      ? (budgetedManHours / Number(actualHours)) * 100
      : null

  const getEfficiencyColor = (pct: number) => {
    if (pct >= 100) return 'text-green-600'
    if (pct >= 80) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getEfficiencyLabel = (pct: number) => {
    if (pct >= 100) return 'At or under budget'
    if (pct >= 90) return 'Slightly over budget'
    if (pct >= 80) return 'Ahead of the curve'
    if (pct >= 60) return 'Typical — room to improve'
    return 'Significant overrun — review scope'
  }

  const handleSave = async () => {
    if (!actualHours || Number(actualHours) <= 0) {
      toast.error('Enter actual man hours from payroll')
      return
    }
    setSaving(true)

    try {
      const record = {
        estimate_id: estimateId,
        budgeted_man_hours: budgetedManHours,
        actual_man_hours: Number(actualHours),
        efficiency_percent: efficiencyPercent,
        notes: notes || null,
      }

      if (existing) {
        await supabase
          .from('job_efficiency')
          .update(record)
          .eq('id', existing.id)
      } else {
        await supabase.from('job_efficiency').insert(record)
      }

      // Optionally update company efficiency rating
      if (updateCompanyRate && company && efficiencyPercent) {
        const currentRate = company.efficiency_rating
        // Rolling average if they have an existing rate
        const newRate = currentRate
          ? (currentRate + efficiencyPercent) / 2
          : efficiencyPercent

        await supabase
          .from('companies')
          .update({ efficiency_rating: Math.round(newRate * 10) / 10 })
          .eq('id', company.id)

        toast.success(`Company efficiency updated to ${newRate.toFixed(1)}%`)
      }

      toast.success('Efficiency tracked')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border-2 border-gold/40 bg-white p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-gold-dark" />
          <h3 className="text-sm font-semibold text-navy">
            Efficiency Tracker — {jobName}
          </h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-navy">
          <X size={16} />
        </button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        How did the crew do? Enter actual man hours from payroll to track efficiency.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-navy/5 p-3 text-center">
          <p className="text-2xl font-bold text-navy">{budgetedManHours}</p>
          <p className="text-xs text-muted-foreground">Budgeted MH</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Actual Man Hours</label>
          <input
            type="number"
            step={0.5}
            min={0}
            value={actualHours}
            onChange={(e) => setActualHours(e.target.value ? Number(e.target.value) : '')}
            className="w-full rounded-lg border border-input px-3 py-2.5 text-center text-lg font-bold outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            placeholder="0"
          />
          <p className="mt-0.5 text-[10px] text-muted-foreground text-center">From payroll</p>
        </div>
      </div>

      {/* Live efficiency readout */}
      {efficiencyPercent !== null && (
        <div className={`mb-4 rounded-lg p-4 text-center ${
          efficiencyPercent >= 100 ? 'bg-green-50' : efficiencyPercent >= 80 ? 'bg-yellow-50' : 'bg-red-50'
        }`}>
          <div className="flex items-center justify-center gap-2">
            {efficiencyPercent >= 100 ? (
              <TrendingUp size={20} className="text-green-600" />
            ) : (
              <TrendingDown size={20} className={efficiencyPercent >= 80 ? 'text-yellow-600' : 'text-red-600'} />
            )}
            <span className={`text-3xl font-bold ${getEfficiencyColor(efficiencyPercent)}`}>
              {efficiencyPercent.toFixed(1)}%
            </span>
          </div>
          <p className={`mt-1 text-xs font-medium ${getEfficiencyColor(efficiencyPercent)}`}>
            {getEfficiencyLabel(efficiencyPercent)}
          </p>
          {Number(actualHours) > budgetedManHours && (
            <p className="mt-1 text-xs text-muted-foreground">
              {(Number(actualHours) - budgetedManHours).toFixed(1)} hours over budget
            </p>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium">Notes (optional)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-gold"
          placeholder="Weather delay, scope change, etc."
        />
      </div>

      {efficiencyPercent !== null && (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateCompanyRate}
            onChange={(e) => setUpdateCompanyRate(e.target.checked)}
            className="rounded"
          />
          <span className="text-muted-foreground">
            Update my company efficiency rate (rolling average)
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          {existing ? 'Cancel' : 'Skip — This was an outlier'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !actualHours}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? 'Saving...' : existing ? 'Update' : 'Track Efficiency'}
        </button>
      </div>
    </div>
  )
}
