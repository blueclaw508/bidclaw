import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { loadCompanySettings } from '@/lib/companySettings'
import type { CompanySettings } from '@/lib/types'

/**
 * Setup status provider — mounted inside AuthContext at the AppShell
 * level so /app/* routes can read whether the user has completed the
 * onboarding wizard.
 *
 * setupCompleted is derived from setup_completed_at !== null. That
 * column is the gate — data presence is NOT the gate. A user can
 * fill in every field and Skip the wizard; setupCompleted stays
 * false until they explicitly click Complete Setup.
 *
 * Re-fetch behavior: loads ONCE on mount per authenticated session.
 * Explicit refreshSettings() re-loads when something changes (wizard
 * completion, settings page save). No per-route re-fetch.
 */
interface SetupContextValue {
  /** True when the user has explicitly completed onboarding. */
  setupCompleted: boolean
  /** Loaded row or null while loading / on error. */
  companySettings: CompanySettings | null
  /** Re-load from DB. Call after wizard completion or settings save. */
  refreshSettings: () => Promise<void>
  /** True during the initial mount load. False after. */
  loading: boolean
}

const SetupContext = createContext<SetupContextValue | null>(null)

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshSettings = useCallback(async () => {
    try {
      const row = await loadCompanySettings()
      setCompanySettings(row)
    } catch {
      // RLS or network failure — leave state as-is so the banner /
      // wizard surfaces don't flicker. Real error toasts surface
      // from the settings pages themselves on save attempts.
      setCompanySettings(null)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setCompanySettings(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void refreshSettings().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user, refreshSettings])

  const setupCompleted = companySettings?.setup_completed_at !== null
    && companySettings?.setup_completed_at !== undefined

  return (
    <SetupContext.Provider
      value={{ setupCompleted, companySettings, refreshSettings, loading }}
    >
      {children}
    </SetupContext.Provider>
  )
}

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext)
  if (!ctx) {
    throw new Error('useSetup must be used inside <SetupProvider>')
  }
  return ctx
}
