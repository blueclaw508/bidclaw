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

/**
 * Set when a "forgot password" email was requested from THIS browser, and
 * cleared the moment a sign-in completes from the form. AuthCallback reads
 * it to route a recovery link to the set-password page.
 *
 * A flag in localStorage rather than the client's PASSWORD_RECOVERY event
 * because, under the PKCE flow this app uses, the client stores the
 * recovery marker as "PASSWORD_RECOVERY" and then compares it to
 * "recovery" — so the event never fires (auth-js 2.99). The flag is
 * exactly as reliable as PKCE itself: both only work in the browser that
 * started the flow, which is where the code verifier lives.
 */
const RECOVERY_FLAG = 'bidclaw.password_recovery'

const LOCKDOWN_MESSAGE =
  'This email is not authorized for BidClaw during the Phase 1 lockdown.'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  /**
   * Send a magic-link email. Returns null on success, or an error message
   * suitable for showing to the user.
   */
  sendMagicLink: (email: string) => Promise<string | null>
  /**
   * Sign in with email + password. Tries BidClaw first; if BidClaw refuses,
   * offers the same password to Know Your Numbers through the kyn-login
   * bridge, which mirrors it onto this account when KYN accepts it. Returns
   * null on success, or a message for the form.
   */
  signInWithPassword: (email: string, password: string) => Promise<string | null>
  /** Email a password-reset link. Returns null on success or a message. */
  sendPasswordReset: (email: string) => Promise<string | null>
  /** Set or change the signed-in user's password. Null on success. */
  updatePassword: (password: string) => Promise<string | null>
  /** True while a recovery link brought this session in and no password has been set yet. */
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readRecoveryFlag(): boolean {
  try {
    return localStorage.getItem(RECOVERY_FLAG) === '1'
  } catch {
    return false
  }
}
function writeRecoveryFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(RECOVERY_FLAG, '1')
    else localStorage.removeItem(RECOVERY_FLAG)
  } catch {
    /* storage unavailable — the flow degrades to a normal sign-in */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [passwordRecovery, setPasswordRecovery] = useState<boolean>(readRecoveryFlag)

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

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Kept as a second signal for the day auth-js emits it under PKCE.
      if (event === 'PASSWORD_RECOVERY') {
        writeRecoveryFlag(true)
        setPasswordRecovery(true)
      }
      // Deferred, per Supabase's own guidance: the client holds its auth
      // lock while this callback runs, and enforceAllowlist now makes an
      // RPC (is_email_allowed) which needs the session — and therefore the
      // lock — to attach a token. Calling it synchronously here is the
      // documented deadlock. A macrotask later, the lock is released.
      setTimeout(() => {
        if (!cancelled) void enforceAllowlist(s)
      }, 0)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [enforceAllowlist])

  const clearPasswordRecovery = useCallback(() => {
    writeRecoveryFlag(false)
    setPasswordRecovery(false)
  }, [])

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
      return LOCKDOWN_MESSAGE
    }
    // A magic link is an ordinary sign-in, not a recovery; a stale flag
    // from an abandoned reset must not bounce them to set-password.
    clearPasswordRecovery()
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return error?.message ?? null
  }, [clearPasswordRecovery])

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const trimmed = email.trim().toLowerCase()
      if (!trimmed || !password) return 'Enter your email and password.'
      if ((await isEmailAllowed(trimmed)) === false) {
        return LOCKDOWN_MESSAGE
      }
      clearPasswordRecovery()

      // 1. BidClaw's own password. The common case after the first visit.
      const first = await supabase.auth.signInWithPassword({ email: trimmed, password })
      if (!first.error) return null

      // Anything other than a refused credential is a real error — say it.
      const refused = /invalid login credentials/i.test(first.error.message)
      if (!refused) return first.error.message

      // 2. The bridge: is this their Know Your Numbers password? kyn-login
      //    verifies it against KYN and, if KYN says yes, mirrors it onto
      //    this account (creating the account if the allowlist permits).
      const { data, error } = await supabase.functions.invoke('kyn-login', {
        body: { email: trimmed, password },
      })
      if (error) {
        // The function's own sentence is the useful one; dig it out.
        let msg = 'Wrong email or password.'
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const payload = (await ctx.json()) as { error?: string }
            if (payload?.error) msg = payload.error
          } catch {
            /* keep the default */
          }
        }
        return msg
      }
      if (!(data as { ok?: boolean } | null)?.ok) return 'Wrong email or password.'

      // 3. KYN accepted and the password now lives here too. Sign in for real.
      const second = await supabase.auth.signInWithPassword({ email: trimmed, password })
      return second.error?.message ?? null
    },
    [clearPasswordRecovery]
  )

  const sendPasswordReset = useCallback(async (email: string): Promise<string | null> => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return 'Enter your email.'
    if ((await isEmailAllowed(trimmed)) === false) {
      return LOCKDOWN_MESSAGE
    }
    // Mark BEFORE the request goes out: the link lands in this browser and
    // AuthCallback needs to know it was a recovery, not a magic link.
    writeRecoveryFlag(true)
    setPasswordRecovery(true)
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    if (error) {
      clearPasswordRecovery()
      return error.message
    }
    return null
  }, [clearPasswordRecovery])

  const updatePassword = useCallback(async (password: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return error.message
    clearPasswordRecovery()
    return null
  }, [clearPasswordRecovery])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        user,
        sendMagicLink,
        signInWithPassword,
        sendPasswordReset,
        updatePassword,
        passwordRecovery,
        clearPasswordRecovery,
        signOut,
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
