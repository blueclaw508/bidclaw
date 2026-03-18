import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { QCCompanyProfile, QCSettings } from '@/lib/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** QuickCalc company profile (from kyn_user_settings.settings_data.companyProfile) */
  companyProfile: QCCompanyProfile | null
  /** Full QuickCalc settings blob */
  qcSettings: QCSettings | null
  /** Whether user has QC settings (i.e. existing QuickCalc user) */
  hasQCAccount: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshSettings: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [companyProfile, setCompanyProfile] = useState<QCCompanyProfile | null>(null)
  const [qcSettings, setQcSettings] = useState<QCSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('kyn_user_settings')
      .select('settings_data')
      .eq('user_id', userId)
      .maybeSingle()

    if (data?.settings_data) {
      const settings = data.settings_data as QCSettings
      setQcSettings(settings)
      setCompanyProfile(settings.companyProfile ?? null)
    } else {
      setQcSettings(null)
      setCompanyProfile(null)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    if (user) await fetchSettings(user.id)
  }, [user, fetchSettings])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) fetchSettings(s.user.id)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        fetchSettings(s.user.id)
      } else {
        setQcSettings(null)
        setCompanyProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchSettings])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return error?.message ?? null
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setQcSettings(null)
    setCompanyProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        companyProfile,
        qcSettings,
        hasQCAccount: qcSettings != null,
        loading,
        signIn,
        signUp,
        signOut,
        refreshSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
