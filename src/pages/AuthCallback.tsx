import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Landing page after the user clicks a magic-link email. The Supabase
 * client (detectSessionInUrl=true) is already parsing the URL and
 * exchanging the token for a session, which propagates through
 * AuthContext. We just wait for status to settle and bounce.
 */
export default function AuthCallback() {
  const { status } = useAuth()
  // Track elapsed time so we can show a clearer message if the exchange stalls.
  const [stallMs, setStallMs] = useState(0)

  useEffect(() => {
    if (status !== 'loading') return
    const id = setInterval(() => setStallMs((ms) => ms + 500), 500)
    return () => clearInterval(id)
  }, [status])

  if (status === 'authenticated') {
    return <Navigate to="/app/projects" replace />
  }

  if (status === 'forbidden') {
    // Email passed auth but failed the allowlist. Bounce back to the
    // marketing page so the login section can render the rejection state.
    return <Navigate to="/" replace state={{ allowlistRejected: true }} />
  }

  if (status === 'unauthenticated') {
    // No session arrived — link was bad, expired, or already used.
    return <Navigate to="/" replace state={{ linkInvalid: true }} />
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-[#0c1428] px-4 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-[#60A5FA]" />
      <p className="text-sm font-medium text-white">Signing you in…</p>
      {stallMs > 4000 && (
        <p className="max-w-xs text-xs text-slate-400">
          Still working — magic-link sign-in occasionally takes a few seconds.
          If this hangs past 30 seconds, return to the marketing page and
          request a new link.
        </p>
      )}
    </div>
  )
}
