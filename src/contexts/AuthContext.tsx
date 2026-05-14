import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { isEmailAllowed } from '@/lib/authAllowlist'

type AuthStatus =
  | 'loading'           // initial session check in flight
  | 'unauthenticated'   // no session
  | 'authenticated'     // session present AND email passes allowlist
  | 'forbidden'         // session present BUT email is not allowlisted (Layer 2 reject)

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  /**
   * Send a magic-link email. Returns null on success, or an error message
   * suitable for showing to the user.
   */
  sendMagicLink: (email: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  // Apply Layer 2 enforcement: any session whose email is not allowlisted
  // gets signed out immediately. This is the application-side counterpart to
  // the Supabase trigger; both must agree.
  const enforceAllowlist = useCallback(async (s: Session | null) => {
    if (!s?.user) {
      setSession(null)
      setUser(null)
      setStatus('unauthenticated')
      return
    }
    if (!isEmailAllowed(s.user.email)) {
      // Forbidden — sign out and surface the rejection.
      setStatus('forbidden')
      setSession(null)
      setUser(null)
      await supabase.auth.signOut()
      return
    }
    setSession(s)
    setUser(s.user)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      void enforceAllowlist(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void enforceAllowlist(s)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [enforceAllowlist])

  const sendMagicLink = useCallback(async (email: string): Promise<string | null> => {
    const trimmed = email.trim().toLowerCase()
    // Belt-and-suspenders: refuse to even send a link to a disallowed address.
    // The DB trigger will reject signups anyway, but failing fast here avoids
    // sending an email that can never actually grant access.
    if (!isEmailAllowed(trimmed)) {
      return 'This email is not authorized for BidClaw during the Phase 1 lockdown.'
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return error?.message ?? null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  return (
    <AuthContext.Provider
      value={{ status, session, user, sendMagicLink, signOut }}
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
