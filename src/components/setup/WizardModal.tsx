import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  X,
} from 'lucide-react'
import { CompanyProfileForm } from '@/components/settings/CompanyProfileForm'
import { EnterMyNumbersForm } from '@/components/settings/EnterMyNumbersForm'
import { ConfirmationStep } from '@/components/setup/ConfirmationStep'
import { useSetup } from '@/contexts/SetupContext'
import {
  loadCompanyEquipmentRates,
  loadCompanyLaborTypes,
  loadCompanySettings,
  markSetupComplete,
  updateCompanyEquipmentRate,
  updateCompanyLaborType,
  updateCompanySettings,
} from '@/lib/companySettings'
import type {
  CompanyEquipmentRate,
  CompanyLaborType,
  CompanySettings,
  WizardStep,
} from '@/lib/types'

/**
 * Three-step setup wizard. Composes the existing CompanyProfileForm +
 * EnterMyNumbersForm unchanged — wizard-parent owns state and handles
 * step advancement.
 *
 * Save semantics (locked in plan as Option C):
 *   - Field changes update LOCAL state only.
 *   - Bulk save fires at navigation boundaries: Continue, Back, Skip,
 *     Complete Setup, X-button-close, ESC, backdrop click.
 *   - Save runs in parallel across the 3 data sources, diffing local
 *     vs server and patching only what's dirty.
 *   - If save fails: inline error, don't advance the step, don't
 *     lose user data.
 *
 * Wizard-complete gate: setup_completed_at populated when "Complete
 * Setup" succeeds. Skip-for-now leaves it NULL but the data persists.
 */

interface WizardModalProps {
  open: boolean
  /** Skip-for-now / ESC / backdrop close. Persists dirty state, leaves setup_completed_at NULL. */
  onClose: () => void
}

const STEPS: readonly { id: WizardStep; label: string }[] = [
  { id: 'company_info', label: 'Company Profile' },
  { id: 'kyn', label: 'Enter My Numbers' },
  { id: 'confirmation', label: 'Review' },
]

export function WizardModal({ open, onClose }: WizardModalProps) {
  const { refreshSettings } = useSetup()

  // ── State ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>('company_info')

  // Local working copy of all three data sources. server* shadows are
  // what we last saw from the DB; local* is the user's in-progress
  // view. Diff between them = what needs to save on navigation.
  const [serverSettings, setServerSettings] = useState<CompanySettings | null>(null)
  const [serverLabor, setServerLabor] = useState<CompanyLaborType[]>([])
  const [serverEquipment, setServerEquipment] = useState<CompanyEquipmentRate[]>([])
  const [localSettings, setLocalSettings] = useState<Partial<CompanySettings>>({})
  const [localLabor, setLocalLabor] = useState<CompanyLaborType[]>([])
  const [localEquipment, setLocalEquipment] = useState<CompanyEquipmentRate[]>([])

  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step1Valid, setStep1Valid] = useState(false)
  const [step2Valid, setStep2Valid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Load on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoaded(false)
    setLoadError(null)
    setSaveError(null)
    setStep('company_info')
    void Promise.all([
      loadCompanySettings(),
      loadCompanyLaborTypes(),
      loadCompanyEquipmentRates(),
    ])
      .then(([s, lt, er]) => {
        if (cancelled) return
        setServerSettings(s)
        setServerLabor(lt)
        setServerEquipment(er)
        setLocalSettings(s)
        setLocalLabor(lt)
        setLocalEquipment(er)
        setLoaded(true)
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // ── Body scroll lock + ESC handler ─────────────────────────────────
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        void handleSkip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
    // handleSkip is stable enough via closure; including would cause a
    // listener thrash on every render. Manual gate via `open` is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Diff detection ─────────────────────────────────────────────────
  const settingsDirty = (() => {
    if (!serverSettings) return false
    return Object.keys(localSettings).some((k) => {
      const key = k as keyof CompanySettings
      return localSettings[key] !== serverSettings[key]
    })
  })()
  const laborDirty = serverLabor.some((srv) => {
    const lcl = localLabor.find((r) => r.id === srv.id)
    return (
      !lcl ||
      (lcl.name ?? null) !== (srv.name ?? null) ||
      (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
    )
  })
  const equipmentDirty = serverEquipment.some((srv) => {
    const lcl = localEquipment.find((r) => r.id === srv.id)
    return (
      !lcl ||
      (lcl.name ?? null) !== (srv.name ?? null) ||
      (lcl.rate_per_hour ?? null) !== (srv.rate_per_hour ?? null)
    )
  })

  // ── Save dirty state ───────────────────────────────────────────────
  // Returns true if save succeeded (or there was nothing to save).
  // Returns false if any patch failed — error is set in state.
  const persistDirty = useCallback(async (): Promise<boolean> => {
    if (!serverSettings) return true
    setSaving(true)
    setSaveError(null)
    try {
      const tasks: Promise<unknown>[] = []

      if (settingsDirty) {
        const patch: Partial<CompanySettings> = {}
        for (const k of Object.keys(localSettings) as (keyof CompanySettings)[]) {
          if (localSettings[k] !== serverSettings[k]) {
            ;(patch as Record<string, unknown>)[k] = localSettings[k] as unknown
          }
        }
        if (Object.keys(patch).length > 0) {
          tasks.push(updateCompanySettings(patch))
        }
      }

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
        return true
      }

      await Promise.all(tasks)

      // Re-fetch to sync local with whatever the DB has now.
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
      setSaving(false)
      return true
    } catch (err) {
      setSaveError((err as Error).message)
      setSaving(false)
      return false
    }
  }, [
    serverSettings,
    serverLabor,
    serverEquipment,
    localSettings,
    localLabor,
    localEquipment,
    settingsDirty,
  ])

  // ── Navigation handlers — each persists dirty state first ──────────
  const handleContinue = useCallback(async () => {
    const ok = await persistDirty()
    if (!ok) return // error shown, stay on step
    if (step === 'company_info') setStep('kyn')
    else if (step === 'kyn') setStep('confirmation')
  }, [persistDirty, step])

  const handleBack = useCallback(async () => {
    const ok = await persistDirty()
    if (!ok) return
    if (step === 'kyn') setStep('company_info')
    else if (step === 'confirmation') setStep('kyn')
  }, [persistDirty, step])

  const handleSkip = useCallback(async () => {
    const ok = await persistDirty()
    if (!ok) return
    onClose()
  }, [persistDirty, onClose])

  const handleComplete = useCallback(async () => {
    const ok = await persistDirty()
    if (!ok) return
    setSaving(true)
    try {
      await markSetupComplete()
      await refreshSettings()
      onClose()
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [persistDirty, onClose, refreshSettings])

  // ── Field-change handlers (LOCAL state only) ───────────────────────
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

  if (!open) return null

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const canContinue =
    !saving &&
    ((step === 'company_info' && step1Valid) ||
      (step === 'kyn' && step2Valid))

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        // Only the backdrop itself (not bubbled clicks from inside).
        if (e.target === e.currentTarget) void handleSkip()
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        {/* ── Header: gradient + step indicator + X ───────────────────── */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-white shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold">Set up BidClaw</h1>
              <p className="text-blue-100 text-xs mt-0.5">
                Three quick steps. You can change any of this later in Settings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={saving}
              aria-label="Close (skip for now)"
              className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="mt-4 flex items-center gap-2">
            {STEPS.map((s, i) => {
              const isActive = i === stepIndex
              const isComplete = i < stepIndex
              return (
                <div key={s.id} className="flex items-center gap-2 flex-1">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                      isActive
                        ? 'bg-white text-blue-700'
                        : isComplete
                          ? 'bg-emerald-400 text-white'
                          : 'bg-white/20 text-white/70'
                    }`}
                  >
                    {isComplete ? <Check className="w-3 h-3" /> : i + 1}
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      isActive ? 'text-white' : 'text-blue-100'
                    }`}
                  >
                    {s.label}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 h-px bg-white/20" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Body: scrollable form area ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-gray-50">
          {loadError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              Couldn't load setup data: {loadError}
            </div>
          ) : !loaded ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : step === 'company_info' ? (
            <CompanyProfileForm
              value={localSettings}
              onChange={handleSettingsChange}
              mode="wizard"
              onValidityChange={setStep1Valid}
            />
          ) : step === 'kyn' ? (
            <EnterMyNumbersForm
              value={localSettings}
              onChange={handleSettingsChange}
              laborTypes={localLabor}
              onLaborChange={handleLaborChange}
              equipmentRates={localEquipment}
              onEquipmentChange={handleEquipmentChange}
              mode="wizard"
              onValidityChange={setStep2Valid}
            />
          ) : (
            <ConfirmationStep
              settings={localSettings}
              laborTypes={localLabor}
              equipmentRates={localEquipment}
            />
          )}
        </div>

        {/* ── Footer: Skip / Back / Continue or Complete Setup ────────── */}
        <div className="border-t border-gray-200 bg-white px-6 py-4 shrink-0">
          {saveError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Couldn't save: {saveError}. Try again — your data is safe.</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={saving}
              className="text-xs font-semibold text-gray-500 hover:text-blue-600 disabled:opacity-50"
            >
              Skip for now
            </button>
            <div className="flex items-center gap-2">
              {step !== 'company_info' && (
                <button
                  type="button"
                  onClick={() => void handleBack()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              )}
              {step === 'confirmation' ? (
                <button
                  type="button"
                  onClick={() => void handleComplete()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {saving ? 'Finishing…' : 'Complete Setup'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleContinue()}
                  disabled={!canContinue}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Continue'}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
          {laborDirty || equipmentDirty || settingsDirty ? (
            <p className="mt-2 text-[11px] text-gray-400 text-right">
              Unsaved changes will be saved when you continue.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
