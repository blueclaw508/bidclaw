import { useState, useEffect, useCallback } from 'react'
import { DollarSign, Save, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { KYN_RATE_DEFAULTS } from '@/lib/jamiePrompt'
import { PageLayout, CardSection } from '@/components/PageLayout'

export default function MyKYNNumbers() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [laborRate, setLaborRate] = useState(String(KYN_RATE_DEFAULTS.retail_labor_rate))
  const [materialMarkup, setMaterialMarkup] = useState(String(KYN_RATE_DEFAULTS.material_markup))
  const [subMarkup, setSubMarkup] = useState(String(KYN_RATE_DEFAULTS.sub_markup))
  const [equipmentMarkup, setEquipmentMarkup] = useState(String(KYN_RATE_DEFAULTS.equipment_markup))

  const fetchRates = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('bidclaw_kyn_rates')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (data) {
      setLaborRate(String(data.retail_labor_rate ?? KYN_RATE_DEFAULTS.retail_labor_rate))
      setMaterialMarkup(String(data.material_markup ?? KYN_RATE_DEFAULTS.material_markup))
      setSubMarkup(String(data.sub_markup ?? KYN_RATE_DEFAULTS.sub_markup))
      setEquipmentMarkup(String(data.equipment_markup ?? KYN_RATE_DEFAULTS.equipment_markup))
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchRates()
  }, [fetchRates])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setSaved(false)

    const row = {
      user_id: user.id,
      retail_labor_rate: parseFloat(laborRate) || KYN_RATE_DEFAULTS.retail_labor_rate,
      material_markup: parseFloat(materialMarkup) || KYN_RATE_DEFAULTS.material_markup,
      sub_markup: parseFloat(subMarkup) || KYN_RATE_DEFAULTS.sub_markup,
      equipment_markup: parseFloat(equipmentMarkup) || KYN_RATE_DEFAULTS.equipment_markup,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('bidclaw_kyn_rates')
      .upsert(row, { onConflict: 'user_id' })

    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  return (
    <PageLayout
      icon={<DollarSign size={24} />}
      title="My KYN Numbers"
      subtitle="These are your rates from Know Your Numbers. Jamie uses them on every estimate."
    >
      <CardSection
        icon={<DollarSign size={18} />}
        title="Pricing Rates"
        subtitle="Jamie uses these when building estimates"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-blue-600" size={24} />
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Retail Labor Rate ($/hr)
              </label>
              <p className="mb-1 text-xs text-slate-400">
                What every labor hour is billed at — your fully burdened rate.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-12 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">/hr</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Material Markup (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={materialMarkup}
                    onChange={(e) => setMaterialMarkup(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Sub Markup (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={subMarkup}
                    onChange={(e) => setSubMarkup(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Equipment Markup (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={equipmentMarkup}
                    onChange={(e) => setEquipmentMarkup(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              {saved && (
                <span className="text-sm font-medium text-green-600">Saved</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </CardSection>
    </PageLayout>
  )
}
