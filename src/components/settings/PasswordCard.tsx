import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Set or change the account password from Settings. A magic-link account
 * has no password until it does this (or arrives through the KYN bridge);
 * once it has one, the sign-in form takes it directly.
 */
export function PasswordCard() {
  const { updatePassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setPassword('')
    setConfirm('')
    setError(null)
    setOpen(false)
  }

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
    toast.success('Password saved. Use it next time you sign in.')
    reset()
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-gray-900">Password</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sign in with a password instead of waiting on an email link. If you
            use Know Your Numbers, that password already works here.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <KeyRound className="h-4 w-4" />
            Set password
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 max-w-sm space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">New password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="At least 8 characters"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="Same again"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save password
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
