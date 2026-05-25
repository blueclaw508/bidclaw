import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSetup } from '@/contexts/SetupContext'

/**
 * Persistent amber banner shown above /app/* content when the user
 * hasn't completed setup. Dismissible per-session — the X button
 * sets a sessionStorage flag so the banner stays hidden until the
 * tab closes. Banner returns in a fresh session.
 *
 * Completion of the wizard (setup_completed_at populated) makes
 * the banner disappear permanently via the setupCompleted check.
 *
 * Click "Set up now" → opens the WizardModal via SetupContext.
 */

/** sessionStorage key for per-session dismissal. Scoped to user. */
function dismissKey(userId: string): string {
  return `setup_banner_dismissed_${userId}`
}

export function SetupBanner() {
  const { user } = useAuth()
  const { setupCompleted, loading, openWizard } = useSetup()
  const [dismissed, setDismissed] = useState(false)

  // Read sessionStorage flag on mount (per user). Re-checks when user
  // changes (sign-out + sign-in flow).
  useEffect(() => {
    if (!user) {
      setDismissed(false)
      return
    }
    setDismissed(sessionStorage.getItem(dismissKey(user.id)) === '1')
  }, [user])

  const handleDismiss = useCallback(() => {
    if (!user) return
    sessionStorage.setItem(dismissKey(user.id), '1')
    setDismissed(true)
  }, [user])

  // Hide while loading (avoid flash of incorrect banner during the
  // SetupContext initial fetch), when setup is already complete, when
  // the user dismissed this session, or when not signed in.
  if (loading || setupCompleted || dismissed || !user) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100">
          <Sparkles className="h-4 w-4 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1 text-sm text-amber-900">
          <strong className="font-semibold">Complete your setup</strong>
          <span className="ml-2 text-amber-800">
            to enable proposal creation.
          </span>
        </div>
        <button
          type="button"
          onClick={openWizard}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 shadow-sm"
        >
          Set up now
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss for this session"
          title="Dismiss for this session"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
