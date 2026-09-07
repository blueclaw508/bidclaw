import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Where a password-reset link lands (AuthCallback routes here when the
 * session came from a recovery email). Also reachable directly by anyone
 * signed in who wants to set a password for the first time — a magic-link
 * account has none until it does this or comes through the KYN bridge.
 *
 * Deliberately outside the AppShell: a reset is one job, and the nav is a
 * distraction from it.
 */
export default function SetPassword() {
  const { user, updatePassword, passwordRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError("Those passwords don't match.")
      return
    }
    setSaving(true)
    const err = await updatePassword(password)
    setSaving(false)
    if (err) {
      setError(err)
      return
    }
    navigate('/app/projects', { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-[#0c1428] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-center text-2xl font-bold text-white">
          {passwordRecovery ? 'Choose a new password' : 'Set a password'}
        </h1>
        <p className="mt-2 text-center text-sm text-blue-100">
          For <strong className="text-white">{user?.email ?? 'your account'}</strong>.
          Next time, sign in with it instead of waiting on an email link.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-blue-100">
              New password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-blue-200/60 focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/30"
              placeholder="At least 8 characters"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-blue-100">
              Confirm password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-blue-200/60 focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/30"
              placeholder="Same again"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#C9A84C] py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-[#A8872E] hover:shadow-xl disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save password'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate('/app/projects', { replace: true })}
          className="mt-6 block w-full text-center text-xs font-medium text-blue-200 hover:text-white"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
