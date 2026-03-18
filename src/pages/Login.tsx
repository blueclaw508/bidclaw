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
    if (!email) { setError('Please enter your email address'); return }
    setLoading(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    })
    if (resetErr) setError(resetErr.message)
    else setResetSent(true)
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const err = isSignUp ? await signUp(email, password) : await signIn(email, password)
    if (err) setError(err)
    else if (isSignUp) setSignUpSuccess(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen">
      {/* Left — Branded cover */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5aa0 40%, #4a7bc8 70%, #6b9bd2 100%)' }}>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur text-white font-bold text-xl">
              BC
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">BidClaw</span>
          </div>
          <p className="text-white/70 text-sm ml-15">by Blue Claw Associates</p>
        </div>

        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            AI-Powered<br />Estimating
          </h2>
          <p className="text-white/80 text-lg max-w-md">
            Upload plans. Get takeoffs. Send to QuickCalc. The fastest way to go from scope to estimate.
          </p>
          <div className="flex gap-6 text-white/60 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-400" />
              AI Work Areas
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-400" />
              Material Takeoffs
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-400" />
              QuickCalc Integration
            </div>
          </div>
        </div>

        <p className="text-white/40 text-xs">
          &copy; {new Date().getFullYear()} Blue Claw Associates / The Blue Claw Group
        </p>
      </div>

      {/* Right — Auth form */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl text-white font-bold text-xl"
              style={{ background: 'linear-gradient(135deg, #1e3a5f, #4a7bc8)' }}>
              BC
            </div>
            <h1 className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>BidClaw</h1>
            <p className="mt-1 text-sm text-slate-500">AI-Powered Estimating</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
            {resetSent ? (
              <div className="text-center">
                <div className="mb-3 text-4xl">🔑</div>
                <h2 className="text-lg font-semibold" style={{ color: '#1e3a5f' }}>Check your email</h2>
                <p className="mt-2 text-sm text-slate-500">
                  We sent a password reset link to <strong>{email}</strong>.
                </p>
                <button onClick={() => { setShowReset(false); setResetSent(false) }}
                  className="mt-6 text-sm font-medium text-blue-600 hover:text-blue-800">
                  Back to sign in
                </button>
              </div>
            ) : showReset ? (
              <div>
                <h2 className="mb-2 text-center text-lg font-semibold" style={{ color: '#1e3a5f' }}>Reset Password</h2>
                <p className="mb-6 text-center text-sm text-slate-500">Enter your email and we'll send you a reset link.</p>
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="you@company.com" />
                  </div>
                  {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                    style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
                <p className="mt-4 text-center text-sm text-slate-500">
                  <button onClick={() => { setShowReset(false); setError(null) }}
                    className="font-medium text-blue-600 hover:text-blue-800">Back to sign in</button>
                </p>
              </div>
            ) : signUpSuccess ? (
              <div className="text-center">
                <div className="mb-3 text-4xl">📧</div>
                <h2 className="text-lg font-semibold" style={{ color: '#1e3a5f' }}>Check your email</h2>
                <p className="mt-2 text-sm text-slate-500">
                  We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
                </p>
                <button onClick={() => { setIsSignUp(false); setSignUpSuccess(false) }}
                  className="mt-6 text-sm font-medium text-blue-600 hover:text-blue-800">Back to sign in</button>
              </div>
            ) : (
              <>
                <h2 className="mb-6 text-center text-xl font-bold" style={{ color: '#1e3a5f' }}>
                  {isSignUp ? 'Create Account' : 'Welcome Back'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="you@company.com" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                    <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="••••••••" />
                  </div>
                  {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-lg"
                    style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
                    {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-slate-500">
                  {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                  <button onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
                    className="font-medium text-blue-600 hover:text-blue-800">
                    {isSignUp ? 'Sign in' : 'Sign up'}
                  </button>
                </p>

                {!isSignUp && (
                  <p className="mt-2 text-center">
                    <button onClick={() => { setShowReset(true); setError(null) }}
                      className="text-xs text-slate-400 hover:text-blue-600">Forgot your password?</button>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
