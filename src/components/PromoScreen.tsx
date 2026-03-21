import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  Upload,
  Brain,
  ClipboardList,
  Send,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  PromoScreen — Branded cover page matching QuickCalc                */
/* ------------------------------------------------------------------ */
export function PromoScreen() {
  const { signIn, signUp } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signUpSuccess, setSignUpSuccess] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  /* ---------- handlers ---------- */
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) { setError('Please enter your email address'); return }
    setLoading(true); setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    })
    if (resetErr) setError(resetErr.message)
    else setResetSent(true)
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true)
    const err = isSignUp ? await signUp(email, password) : await signIn(email, password)
    if (err) setError(err)
    else if (isSignUp) setSignUpSuccess(true)
    setLoading(false)
  }

  /* ---------- render ---------- */
  return (
    <div className="flex min-h-screen">
      {/* ====== LEFT — Branded Panel ====== */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-between bg-[#0c1428] relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IGZpbGw9InVybCgjZykiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiLz48L3N2Zz4=')] opacity-60" />
        {/* Gradient accent */}
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-gradient-to-br from-[#2563EB]/20 to-[#7c3aed]/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-gradient-to-br from-[#0EA5E9]/10 to-[#2563EB]/10 blur-3xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
          {/* Logo */}
          <img src="/bidclaw-logo.png" alt="BidClaw" className="mb-8 w-48 rounded-xl object-contain" />

          <h1 className="text-4xl font-bold leading-tight text-white xl:text-5xl">
            The Estimating Engine<br />
            <span className="bg-gradient-to-r from-[#2563EB] to-[#0EA5E9] bg-clip-text text-transparent">
              for BlueQuickCalc
            </span>
          </h1>

          <p className="mt-4 max-w-md text-lg leading-relaxed text-slate-400">
            Upload your construction plans, let Jamie handle the takeoff, and push results
            straight into QuickCalc — cutting hours off every estimate.
          </p>

          {/* How it works — compact */}
          <div className="mt-10 grid grid-cols-2 gap-4">
            {[
              { icon: Upload, label: 'Upload Plans', desc: 'PDFs, images, or scanned drawings' },
              { icon: Brain, label: 'Jamie Takeoff', desc: 'Work areas, quantities, materials' },
              { icon: ClipboardList, label: 'Review & Adjust', desc: 'Tweak quantities and scope' },
              { icon: Send, label: 'Send to QuickCalc', desc: 'Push directly to your estimate' },
            ].map((step, i) => {
              const Icon = step.icon
              return (
                <div key={i} className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#2563EB]/20 text-[#60A5FA]">
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{step.label}</p>
                    <p className="text-[11px] text-slate-500">{step.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Jamie bubble */}
          <div className="mt-10 flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1e3a8a] to-[#2563EB]">
              <span className="text-sm font-bold text-white">J</span>
            </div>
            <div className="max-w-sm rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-sm leading-relaxed text-slate-300">
                "I'm Jamie — your estimating agent. Tell me about your project and
                I'll build a full estimate in minutes."
              </p>
            </div>
          </div>
        </div>

        {/* Bottom brand bar */}
        <div className="relative z-10 border-t border-white/10 px-12 py-4 xl:px-16">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <a href="https://blueclawgroup.com/know-your-numbers/" target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium text-slate-500 hover:text-white transition-colors">
                Know Your Numbers
              </a>
              <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium text-slate-500 hover:text-white transition-colors">
                QuickCalc
              </a>
              <a href="https://blueclawgroup.com" target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium text-slate-500 hover:text-white transition-colors">
                Blue Claw Group
              </a>
            </div>
            <p className="text-[10px] text-slate-600">
              &copy; {new Date().getFullYear()} Blue Claw Group
            </p>
          </div>
        </div>
      </div>

      {/* ====== RIGHT — Login Form ====== */}
      <div className="flex w-full flex-col justify-center bg-white px-8 lg:w-[45%] lg:px-16">
        {/* Mobile logo (hidden on desktop) */}
        <div className="mb-8 lg:hidden">
          <img src="/bidclaw-logo.png" alt="BidClaw" className="mx-auto w-36 rounded-xl object-contain" />
          <p className="mt-3 text-center text-sm text-slate-500">
            The Estimating Engine for BlueQuickCalc
          </p>
        </div>

        <div className="mx-auto w-full max-w-sm">
          {resetSent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                <Send className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
              <p className="mt-2 text-sm text-slate-500">
                We sent a password reset link to <strong>{email}</strong>.
              </p>
              <button
                onClick={() => { setShowReset(false); setResetSent(false) }}
                className="mt-6 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Back to sign in
              </button>
            </div>
          ) : showReset ? (
            <div>
              <h2 className="mb-2 text-2xl font-bold text-slate-900">Reset Password</h2>
              <p className="mb-6 text-sm text-slate-500">
                Enter your email and we'll send you a reset link.
              </p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                    placeholder="you@company.com"
                  />
                </div>
                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-[#2563EB] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
              <p className="mt-4 text-center text-sm text-slate-500">
                <button onClick={() => { setShowReset(false); setError(null) }}
                  className="font-medium text-[#2563EB] hover:text-[#1D4ED8]">
                  Back to sign in
                </button>
              </p>
            </div>
          ) : signUpSuccess ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
              <p className="mt-2 text-sm text-slate-500">
                We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
              </p>
              <button
                onClick={() => { setIsSignUp(false); setSignUpSuccess(false) }}
                className="mt-6 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <h2 className="mb-1 text-2xl font-bold text-slate-900">
                {isSignUp ? 'Create Account' : 'Welcome back'}
              </h2>
              <p className="mb-8 text-sm text-slate-500">
                {isSignUp
                  ? 'Sign up with your QuickCalc email to get started.'
                  : 'Sign in with your QuickCalc credentials.'}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                    placeholder="you@company.com"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-[#2563EB] py-3 text-sm font-semibold text-white transition-all hover:bg-[#1D4ED8] hover:shadow-lg disabled:opacity-50"
                >
                  {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
                  className="font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  {isSignUp ? 'Sign in' : 'Sign up'}
                </button>
              </p>

              {!isSignUp && (
                <p className="mt-2 text-center">
                  <button
                    onClick={() => { setShowReset(true); setError(null) }}
                    className="text-xs text-slate-400 hover:text-[#2563EB]"
                  >
                    Forgot your password?
                  </button>
                </p>
              )}

              {/* QuickCalc requirement note */}
              <div className="mt-8 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <ArrowRight size={16} className="mt-0.5 flex-shrink-0 text-[#2563EB]" />
                <p className="text-xs leading-relaxed text-slate-500">
                  BidClaw requires a <strong className="text-slate-700">BlueQuickCalc</strong> account.
                  Your catalog, production rates, and company profile sync automatically.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
