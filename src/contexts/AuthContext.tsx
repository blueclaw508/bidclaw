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

  // Layer 2: end the session of anyone the allowlist no longer accepts.
  //
  // The signup trigger (Layer 1) is what stops a stranger creating an
  // account. This one exists for the other direction — someone invited in
  // April whose row was deleted in June should not keep a working session
  // for as long as their refresh token lasts.
  const enforceAllowlist = useCallback(async (s: Session | null) => {
    if (!s?.user) {
      setSession(null)
      setUser(null)
      setStatus('unauthenticated')
      return
    }

    const allowed = await isEmailAllowed(s.user.email)

    if (allowed === false) {
      // An explicit no: revoked since they signed up. Sign out.
      setStatus('forbidden')
      setSession(null)
      setUser(null)
      await supabase.auth.signOut()
      return
    }

    // `true`, or `null` when the check could not be reached. A null KEEPS
    // the session on purpose. This user already passed the signup trigger,
    // and RLS still scopes every row they can touch to their own user_id —
    // so a dropped request buys a stranger nothing, while treating it as a
    // denial would throw a working contractor out of a live estimate over a
    // flaky connection. Fail closed at the gate; don't fail closed on a
    // network blip behind it.
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
    // Refuse to send a link to an address that can never complete signup.
    // The DB trigger rejects it regardless; this just means a stranger gets
    // told so on the form instead of waiting on an email that would dead-end.
    //
    // Only an explicit `false` stops us. If the check itself failed we send
    // the link anyway and let the trigger be the judge — an unreachable
    // pre-check is not evidence against the address.
    if ((await isEmailAllowed(trimmed)) === false) {
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
