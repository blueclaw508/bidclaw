import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

export function Login() {
  const { signIn, signUp } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signUpSuccess, setSignUpSuccess] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setError('Please enter your email address')
      return
    }
    setLoading(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    })
    if (resetErr) {
      setError(resetErr.message)
    } else {
      setResetSent(true)
    }
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const err = isSignUp ? await signUp(email, password) : await signIn(email, password)

    if (err) {
      setError(err)
    } else if (isSignUp) {
      setSignUpSuccess(true)
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-navy text-gold font-bold text-2xl">
            BC
          </div>
          <h1 className="text-2xl font-bold text-navy">BidClaw</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI-Powered Estimating</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-white p-8 shadow-sm">
          {resetSent ? (
            <div className="text-center">
              <div className="mb-3 text-4xl">🔑</div>
              <h2 className="text-lg font-semibold text-navy">Check your email</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a password reset link to <strong>{email}</strong>.
              </p>
              <button
                onClick={() => {
                  setShowReset(false)
                  setResetSent(false)
                }}
                className="mt-6 text-sm font-medium text-gold hover:text-gold-dark"
              >
                Back to sign in
              </button>
            </div>
          ) : showReset ? (
            <div>
              <h2 className="mb-2 text-center text-lg font-semibold text-navy">Reset Password</h2>
              <p className="mb-6 text-center text-sm text-muted-foreground">
                Enter your email and we'll send you a reset link.
              </p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    placeholder="you@company.com"
                  />
                </div>
                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                <button
                  onClick={() => {
                    setShowReset(false)
                    setError(null)
                  }}
                  className="font-medium text-gold hover:text-gold-dark"
                >
                  Back to sign in
                </button>
              </p>
            </div>
          ) : signUpSuccess ? (
            <div className="text-center">
              <div className="mb-3 text-4xl">📧</div>
              <h2 className="text-lg font-semibold text-navy">Check your email</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
              </p>
              <button
                onClick={() => {
                  setIsSignUp(false)
                  setSignUpSuccess(false)
                }}
                className="mt-6 text-sm font-medium text-gold hover:text-gold-dark"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <h2 className="mb-6 text-center text-lg font-semibold text-navy">
                {isSignUp ? 'Create Account' : 'Sign In'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    placeholder="you@company.com"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setError(null)
                  }}
                  className="font-medium text-gold hover:text-gold-dark"
                >
                  {isSignUp ? 'Sign in' : 'Sign up'}
                </button>
              </p>

              {!isSignUp && (
                <p className="mt-2 text-center">
                  <button
                    onClick={() => {
                      setShowReset(true)
                      setError(null)
                    }}
                    className="text-xs text-muted-foreground hover:text-gold"
                  >
                    Forgot your password?
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
