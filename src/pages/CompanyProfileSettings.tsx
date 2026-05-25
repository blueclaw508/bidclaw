import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Building2, Loader2, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { CompanyProfileForm } from '@/components/settings/CompanyProfileForm'
import {
  loadCompanySettings,
  updateCompanySettings,
} from '@/lib/companySettings'
import type { CompanySettings } from '@/lib/types'

/**
 * Standalone /app/settings/company-profile page. Holds local state
 * for the company_settings row; QC-style sticky bottom bar with
 * Reset + Save Profile commits to DB.
 */
export default function CompanyProfileSettingsPage() {
  const [server, setServer] = useState<CompanySettings | null>(null)
  const [local, setLocal] = useState<Partial<CompanySettings>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadCompanySettings()
      .then((row) => {
        if (cancelled) return
        setServer(row)
        setLocal(row)
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleChange = useCallback(
    (patch: Partial<CompanySettings>) => {
      setLocal((prev) => ({ ...prev, ...patch }))
    },
    []
  )

  const handleReset = useCallback(() => {
    if (server) setLocal(server)
  }, [server])

  const hasChanges = server
    ? Object.keys(server).some((k) => {
        const key = k as keyof CompanySettings
        return local[key] !== server[key]
      })
    : false

  const handleSave = useCallback(async () => {
    if (!server) return
    setSaving(true)
    try {
      // Only patch fields that actually changed.
      const patch: Partial<CompanySettings> = {}
      for (const k of Object.keys(local) as (keyof CompanySettings)[]) {
        if (local[k] !== server[k]) {
          ;(patch as Record<string, unknown>)[k] = local[k] as unknown
        }
      }
      if (Object.keys(patch).length === 0) {
        setSaving(false)
        return
      }
      const fresh = await updateCompanySettings(patch)
      setServer(fresh)
      setLocal(fresh)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [local, server])

  if (loadError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        Couldn't load company profile: {loadError}
      </div>
    )
  }

  if (!server) {
    return (
      <div className="flex items-center gap-2 text-sm text-brand-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-8">
      <Link
        to="/app/settings"
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-indigo-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to settings
      </Link>

      {/* Header gradient — QC pattern adapted with indigo per the Company Profile theme */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-white/20 p-2 rounded-lg">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">Company Profile</h1>
        </div>
        <p className="text-indigo-100 text-sm">
          Identity + contact info that appears at the top of every PDF proposal you generate.
        </p>
      </div>

      <CompanyProfileForm value={local} onChange={handleChange} mode="settings" />

      {/* Sticky Save / Reset bar — QC pattern */}
      <div className="flex gap-3 sticky bottom-4">
        <button
          type="button"
          onClick={handleReset}
          disabled={!hasChanges || saving}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 rounded-xl px-6 py-3.5 font-medium hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`flex-[2] flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-brand-navy text-white hover:bg-brand-navy-dark'
          }`}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
