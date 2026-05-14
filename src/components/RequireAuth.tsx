import { Loader2 } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Application-layer guard for /app/* routes. Pairs with the Supabase
 * email-allowlist trigger as the second layer of Phase 1 lockdown:
 * a session has to BOTH come from a Supabase user AND have an
 * allowlisted email before the user reaches any protected route.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-brand-surface">
        <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
      </div>
    )
  }

  // Either unauthenticated or session-rejected-by-allowlist → bounce to root.
  // The marketing page's login section will display the right state
  // ("forbidden" vs. "sign in") via AuthContext.status.
  if (status !== 'authenticated') {
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
