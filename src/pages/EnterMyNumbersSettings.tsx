import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, RotateCcw, Save, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EnterMyNumbersForm } from '@/components/settings/EnterMyNumbersForm'
import { KynImportCard } from '@/components/settings/KynImportCard'
import {
  loadCompanyEquipmentRates,
  loadCompanyLaborTypes,
  loadCompanySettings,
  updateCompanyEquipmentRate,
  updateCompanyLaborType,
  updateCompanySettings,
  loadCompanyDivisions,
  createCompanyDivision,
  renameCompanyDivision,
  deleteCompanyDivision,
  addCompanyLaborType,
  deleteCompanyLaborType,
  addCompanyEquipmentRate,
  deleteCompanyEquipmentRate,
} from '@/lib/companySettings'
import { DivisionsCard } from '@/components/settings/DivisionsCard'
import type {
  CompanyDivision,
  CompanyEquipmentRate,
  CompanyLaborType,
  CompanySettings,
} from '@/lib/types'

/**
 * Standalone /app/settings/enter-my-numbers page. Loads three data
 * sources in parallel + holds them all in local state. Sticky bottom
 * bar with Save My Numbers / Reset commits everything in one batch
 * (parallel writes across the three tables; partial failure surfaces
 * via toast and the form stays in its current state).
 */
export default function EnterMyNumbersSettingsPage() {
  const [serverSettings, setServerSettings] = useState<CompanySettings | null>(null)
  const [serverLabor, setServerLabor] = useState<CompanyLaborType[]>([])
  const [serverEquipment, setServerEquipment] = useState<CompanyEquipmentRate[]>([])

  const [localSettings, setLocalSettings] = useState<Partial<CompanySettings>>({})
  const [localLabor, setLocalLabor] = useState<CompanyLaborType[]>([])
  const [localEquipment, setLocalEquipment] = useState<CompanyEquipmentRate[]>([])

  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Adding or removing a ROW writes immediately, unlike the field edits
  // above which batch behind Save. A row is structure, not a value: leaving
  // a half-created one sitting in local state until Save would make Reset
  // ambiguous and let an unsaved row be typed into and then silently lost.
  const [rowBusy, setRowBusy] = useState(false)
  const [divisions, setDivisions] = useState<CompanyDivision[]>([])

  /**
   * Load everything and reset BOTH server and local copies.
   *
   * Also the post-import refresh: the KYN import writes server-side, so the
   * local draft has to be replaced outright rather than merged — anything
   * unsaved at that point was about to be overwritten by the import anyway,
   * and merging would leave the form showing a mix of the two.
   */
  const reloadAll = useCallback(async () => {
    try {
      const [s, lt, er, dv] = await Promise.all([
        loadCompanySettings(),
        loadCompanyLaborTypes(),
        loadCompanyEquipmentRates(),
        loadCompanyDivisions(),
      ])
      setServerSettings(s)
      setServerLabor(lt)
      setServerEquipment(er)
      setLocalSettings(s)
      setLocalLabor(lt)
      setLocalEquipment(er)
      setDivisions(dv)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  const handleSettingsChange = useCallback(
    (patch: Partial<CompanySettings>) => {
      setLocalSettings((prev) => ({ ...prev, ...patch }))
    },
    []
  )

  const handleLaborChange = useCallback(
    (slotNumber: number, patch: Partial<CompanyLaborType>) => {
      setLocalLabor((prev) =>
        prev.map((r) =>
          r.slot_number === slotNumber ? { ...r, ...patch } : r
        )
      )
    },
    []
  )

  const handleEquipmentChange = useCallback(
    (slotNumber: number, patch: Partial<CompanyEquipmentRate>) => {
      setLocalEquipment((prev) =>
        prev.map((r) =>
          r.slot_number === slotNumber ? { ...r, ...patch } : r
        )
      )
    },
    []
  )

  const handleAddLabor = useCallback(async (divisionId: string | null) => {
    setRowBusy(true)
    try {
      const row = await addCompanyLaborType(localLabor, divisionId)
      setServerLabor((prev) => [...prev, row])
      setLocalLabor((prev) => [...prev, row])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add a labor type.")
    } finally {
      setRowBusy(false)
    }
  }, [localLabor])

  const handleDeleteLabor = useCallback(async (id: string) => {
    setRowBusy(true)
    try {
      const unlinked = await deleteCompanyLaborType(id)
      setServerLabor((prev) => prev.filter((r) => r.id !== id))
      setLocalLabor((prev) => prev.filter((r) => r.id !== id))
      if (unlinked > 0) {
        toast.warning(
          `Removed. ${unlinked} kit line${unlinked === 1 ? '' : 's'} that referenced it kept ${unlinked === 1 ? 'its' : 'their'} rate but no longer track this one.`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove that row.")
    } finally {
      setRowBusy(false)
    }
  }, [])

  const handleAddEquipment = useCallback(async (divisionId: string | null) => {
    setRowBusy(true)
    try {
      const row = await addCompanyEquipmentRate(localEquipment, divisionId)
      setServerEquipment((prev) => [...prev, row])
      setLocalEquipment((prev) => [...prev, row])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add equipment.")
    } finally {
      setRowBusy(false)
    }
  }, [localEquipment])

  const handleDeleteEquipment = useCallback(async (id: string) => {
    setRowBusy(true)
    try {
      const unlinked = await deleteCompanyEquipmentRate(id)
      setServerEquipment((prev) => prev.filter((r) => r.id !== id))
      setLocalEquipment((prev) => prev.filter((r) => r.id !== id))
      if (unlinked > 0) {
        toast.warning(
          `Removed. ${unlinked} kit line${unlinked === 1 ? '' : 's'} that referenced it kept ${unlinked === 1 ? 'its' : 'their'} rate but no longer track this one.`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove that row.")
    } finally {
      setRowBusy(false)
    }
  }, [])

  const handleReset = useCallback(() => {
    if (!serverSettings) return
    setLocalSettings(serverSettings)
    setLocalLabor(serverLabor)
    setLocalEquipment(serverEquipment)
  }, [serverSettings, serverLabor, serverEquipment])

  // Diff detection — any field on settings OR any slot's name/rate.
  const hasChanges = (() => {
    if (!serverSettings) return false
    const settingsDirty = Object.keys(serverSettings).some((k) => {
      const key = k as keyof CompanySettings
      return localSettings[key] !== serverSettings[key]
    })
    if (settingsDirty) return true
    const laborDirty = serverLabor.some((srv) => {
      const lcl = localLabor.find((r) => r.id === srv.id)
      return (
        !lcl ||
        (lcl.name ?? null) !== (srv.name ?? null) ||
        (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
      )
    })
    if (laborDirty) return true
    return serverEquipment.some((srv) => {
      const lcl = localEquipment.find((r) => r.id === srv.id)
      return (
        !lcl ||
        (lcl.name ?? null) !== (srv.name ?? null) ||
        (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
      )
    })
  })()

  const handleSave = useCallback(async () => {
    if (!serverSettings) return
    setSaving(true)
    try {
      const tasks: Promise<unknown>[] = []

      // Settings patch
      const settingsPatch: Partial<CompanySettings> = {}
      for (const k of Object.keys(localSettings) as (keyof CompanySettings)[]) {
        if (localSettings[k] !== serverSettings[k]) {
          ;(settingsPatch as Record<string, unknown>)[k] =
            localSettings[k] as unknown
        }
      }
      if (Object.keys(settingsPatch).length > 0) {
        tasks.push(updateCompanySettings(settingsPatch))
      }

      // Labor diffs
      for (const lcl of localLabor) {
        const srv = serverLabor.find((r) => r.id === lcl.id)
        if (!srv) continue
        if (
          (lcl.name ?? null) !== (srv.name ?? null) ||
          (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
        ) {
          tasks.push(
            updateCompanyLaborType(lcl.id, {
              name: lcl.name,
              rate_per_hour: lcl.rate_per_hour,
            })
          )
        }
      }

      // Equipment diffs
      for (const lcl of localEquipment) {
        const srv = serverEquipment.find((r) => r.id === lcl.id)
        if (!srv) continue
        if (
          (lcl.name ?? null) !== (srv.name ?? null) ||
          (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
        ) {
          tasks.push(
            updateCompanyEquipmentRate(lcl.id, {
              name: lcl.name,
              rate_per_hour: lcl.rate_per_hour,
            })
          )
        }
      }

      if (tasks.length === 0) {
        setSaving(false)
        return
      }

      await Promise.all(tasks)

      // Re-fetch to sync local with whatever the DB has now (handles
      // updated_at + any trigger side-effects).
      const [s, lt, er] = await Promise.all([
        loadCompanySettings(),
        loadCompanyLaborTypes(),
        loadCompanyEquipmentRates(),
      ])
      setServerSettings(s)
      setServerLabor(lt)
      setServerEquipment(er)
      setLocalSettings(s)
      setLocalLabor(lt)
      setLocalEquipment(er)

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [
    serverSettings,
    serverLabor,
    serverEquipment,
    localSettings,
    localLabor,
    localEquipment,
  ])

  if (loadError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        Couldn't load Enter My Numbers: {loadError}
      </div>
    )
  }

  if (!serverSettings) {
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
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to settings
      </Link>

      {/* Header gradient — QC's blue-600 → blue-700 exact pattern */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-white/20 p-2 rounded-lg">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">Enter My Numbers</h1>
        </div>
        <p className="text-blue-100 text-sm">
          Set your PDF branding, Target Billable Rates, Markups, and Equipment Rates.
          These numbers drive your proposals.
        </p>
      </div>

      {/* Offered before the form itself: for a KYN subscriber this fills
          the whole page in one click, and typing it all by hand is the
          fallback rather than the default. */}
      <KynImportCard onImported={() => void reloadAll()} />

      <DivisionsCard
        divisions={divisions}
        busy={rowBusy}
        onCreate={async (name) => {
          setRowBusy(true)
          try {
            const d = await createCompanyDivision(name, divisions)
            setDivisions((prev) => [...prev, d])
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't add that division.")
          } finally {
            setRowBusy(false)
          }
        }}
        onRename={async (id, name) => {
          setRowBusy(true)
          try {
            const d = await renameCompanyDivision(id, name)
            setDivisions((prev) => prev.map((x) => (x.id === id ? d : x)))
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't rename that division.")
          } finally {
            setRowBusy(false)
          }
        }}
        onDelete={async (id) => {
          setRowBusy(true)
          try {
            const freed = await deleteCompanyDivision(id)
            setDivisions((prev) => prev.filter((x) => x.id !== id))
            await reloadAll()
            if (freed > 0) {
              toast.info(
                `Division removed. ${freed} rate${freed === 1 ? '' : 's'} moved to Ungrouped — nothing was deleted.`
              )
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't remove that division.")
          } finally {
            setRowBusy(false)
          }
        }}
      />

      <EnterMyNumbersForm
        value={localSettings}
        onChange={handleSettingsChange}
        laborTypes={localLabor}
        onLaborChange={handleLaborChange}
        equipmentRates={localEquipment}
        onEquipmentChange={handleEquipmentChange}
        onAddLabor={(divId) => void handleAddLabor(divId)}
        onDeleteLabor={(id) => void handleDeleteLabor(id)}
        onAddEquipment={(divId) => void handleAddEquipment(divId)}
        onDeleteEquipment={(id) => void handleDeleteEquipment(id)}
        divisions={divisions}
        rowBusy={rowBusy}
        mode="settings"
      />

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
          {saved ? 'Saved!' : saving ? 'Saving…' : 'Save My Numbers'}
        </button>
      </div>
    </div>
  )
}
