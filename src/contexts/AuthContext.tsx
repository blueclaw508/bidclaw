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

const FREE_ACCESS_EMAILS = (import.meta.env.VITE_BIDCLAW_FREE_ACCESS_EMAILS ?? '').split(',').filter(Boolean)

export type SubscriptionTier = 'free' | 'pro' | 'bidclaw'

// 'paid' = full access, 'trial' = 7-day trial (Push blocked), 'trial_expired' = blocked, 'none' = no access
export type BidClawAccessLevel = 'paid' | 'trial' | 'trial_expired' | 'none'

interface AuthContextValue {
  session: Session | null
  user: User | null
  companyProfile: QCCompanyProfile | null
  qcSettings: QCSettings | null
  hasQCAccount: boolean
  subscriptionTier: SubscriptionTier
  canAccessBidClaw: boolean
  bidclawAccessLevel: BidClawAccessLevel
  trialDaysLeft: number
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshSettings: () => Promise<void>
  startCheckout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [companyProfile, setCompanyProfile] = useState<QCCompanyProfile | null>(null)
  const [qcSettings, setQcSettings] = useState<QCSettings | null>(null)
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free')
  const [bidclawPaid, setBidclawPaid] = useState(false)
  const [trialStartDate, setTrialStartDate] = useState<string | null>(null)
  const [, setCheckoutLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async (userId: string, email?: string) => {
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

    // Check subscription tier from kyn_user_settings table
    const { data: tierData } = await supabase
      .from('kyn_user_settings')
      .select('subscription_tier')
      .eq('user_id', userId)
      .maybeSingle()

    let tier: SubscriptionTier = 'free'
    if (tierData?.subscription_tier) {
      tier = tierData.subscription_tier as SubscriptionTier
    } else if (email && FREE_ACCESS_EMAILS.includes(email)) {
      tier = 'bidclaw'
    }
    setSubscriptionTier(tier)

    // Fetch BidClaw access row
    const { data: accessRow } = await supabase
      .from('bidclaw_access')
      .select('paid, trial_start_date')
      .eq('user_id', userId)
      .maybeSingle()

    if (accessRow) {
      setBidclawPaid(accessRow.paid ?? false)
      setTrialStartDate(accessRow.trial_start_date ?? null)
    } else if (tier === 'pro') {
      // Pro user's first visit — auto-start their 7-day trial
      const now = new Date().toISOString()
      const { error } = await supabase.from('bidclaw_access').insert({
        user_id: userId,
        trial_start_date: now,
        paid: false,
      })
      if (!error) {
        setTrialStartDate(now)
        setBidclawPaid(false)
      }
    } else {
      setBidclawPaid(false)
      setTrialStartDate(null)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    if (user) await fetchSettings(user.id, user.email ?? undefined)
  }, [user, fetchSettings])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) fetchSettings(s.user.id, s.user.email ?? undefined)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        fetchSettings(s.user.id, s.user.email ?? undefined)
      } else {
        setQcSettings(null)
        setCompanyProfile(null)
        setSubscriptionTier('free')
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
    setSubscriptionTier('free')
    setBidclawPaid(false)
    setTrialStartDate(null)
  }

  const startCheckout = async () => {
    if (!user) return
    setCheckoutLoading(true)
    try {
      const res = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user.email, user_id: user.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')
      if (data.url) window.location.href = data.url
    } catch {
      // Error handled silently — user can retry
    } finally {
      setCheckoutLoading(false)
    }
  }

  // Compute access level
  const isEmailWhitelisted = user?.email ? FREE_ACCESS_EMAILS.includes(user.email) : false

  let bidclawAccessLevel: BidClawAccessLevel = 'none'
  let trialDaysLeft = 0

  if (subscriptionTier === 'bidclaw' || bidclawPaid || isEmailWhitelisted) {
    bidclawAccessLevel = 'paid'
  } else if (trialStartDate) {
    const msElapsed = Date.now() - new Date(trialStartDate).getTime()
    const daysElapsed = msElapsed / (1000 * 60 * 60 * 24)
    if (daysElapsed <= 7) {
      bidclawAccessLevel = 'trial'
      trialDaysLeft = Math.ceil(7 - daysElapsed)
    } else {
      bidclawAccessLevel = 'trial_expired'
    }
  }

  const canAccessBidClaw = bidclawAccessLevel === 'paid' || bidclawAccessLevel === 'trial'

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        companyProfile,
        qcSettings,
        hasQCAccount: qcSettings != null,
        subscriptionTier,
        canAccessBidClaw,
        bidclawAccessLevel,
        trialDaysLeft,
        loading,
        signIn,
        signUp,
        signOut,
        refreshSettings,
        startCheckout,
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
