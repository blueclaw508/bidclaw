import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Footer } from '@/components/Footer'
import {
  Clock,
  TrendingDown,
  Zap,
  Sliders,
  Link2,
  FileText,
  Upload,
  Brain,
  ClipboardList,
  Send,
  Info,
  CheckCircle2,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  AI Feature Card data                                               */
/* ------------------------------------------------------------------ */
const featureCards = [
  {
    icon: Clock,
    title: 'Slash Estimate Time',
    description:
      'AI-powered takeoffs turn hours of manual counting into minutes. Upload your plans and let BidClaw do the heavy lifting.',
  },
  {
    icon: TrendingDown,
    title: 'Reduce Overhead',
    description:
      'Fewer labor hours per estimate means lower overhead costs and more competitive bids without sacrificing accuracy.',
  },
  {
    icon: Zap,
    title: 'Speed Plan to Proposal',
    description:
      'Go from blueprint to polished proposal faster than ever. BidClaw accelerates every step of the estimating workflow.',
  },
  {
    icon: Sliders,
    title: 'Your Numbers, Your Rates',
    description:
      'BidClaw uses your company rates, markups, and labor factors from QuickCalc — every estimate reflects how you actually bid.',
  },
  {
    icon: Link2,
    title: 'Seamless QuickCalc Integration',
    description:
      'Takeoff data flows directly into BlueQuickCalc line items. No re-keying, no copy-paste, no lost data between systems.',
  },
  {
    icon: FileText,
    title: 'Plan to Proposal Handoff',
    description:
      'From uploaded plans through AI takeoff to a finished QuickCalc estimate — one continuous workflow, start to finish.',
  },
] as const

/* ------------------------------------------------------------------ */
/*  How It Works steps                                                 */
/* ------------------------------------------------------------------ */
const howItWorksSteps = [
  {
    icon: Upload,
    step: '1',
    title: 'Upload Plans',
    description: 'Drop your construction plans into BidClaw — PDFs, images, or scanned drawings.',
  },
  {
    icon: Brain,
    step: '2',
    title: 'AI Takeoff',
    description:
      "BidClaw's AI identifies work areas, counts fixtures, and measures quantities automatically.",
  },
  {
    icon: ClipboardList,
    step: '3',
    title: 'Review & Adjust',
    description:
      'Verify the AI takeoff, tweak quantities, and confirm everything matches the scope.',
  },
  {
    icon: Send,
    step: '4',
    title: 'Send to QuickCalc',
    description:
      'Push your takeoff directly into BlueQuickCalc and generate a complete estimate in seconds.',
  },
] as const

/* ------------------------------------------------------------------ */
/*  PromoScreen Component                                              */
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
    if (!email) {
      setError('Please enter your email address')
      return
    }
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

  /* ---------- render ---------- */
  return (
    <div className="min-h-screen bg-white">
      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] py-20 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IGZpbGw9InVybCgjZykiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiLz48L3N2Zz4=')] opacity-40" />
        <div className="relative mx-auto max-w-5xl px-6 text-center">
          {/* Logo */}
          <img src="/bidclaw-logo.png" alt="BidClaw" className="mx-auto mb-6 h-24 w-24 rounded-2xl object-contain" />

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            BidClaw
          </h1>
          <p className="mt-2 text-lg font-medium text-blue-100 sm:text-xl">
            The AI Estimating Engine for BlueQuickCalc
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base text-blue-200 sm:text-lg">
            Upload your construction plans, let AI handle the takeoff, and push results straight
            into QuickCalc — cutting hours off every estimate.
          </p>
        </div>
      </section>

      {/* ====== AI FEATURE CARDS ====== */}
      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-2 text-center text-3xl font-bold text-slate-900">
            What BidClaw Does for You
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-center text-slate-500">
            Six ways AI-powered estimating transforms your workflow.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((card) => {
              const Icon = card.icon
              return (
                <div
                  key={card.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#DBEAFE] text-[#2563EB]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-slate-900">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{card.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS ====== */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-2 text-center text-3xl font-bold text-slate-900">How It Works</h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-slate-500">
            Four simple steps from plans to estimate.
          </p>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {howItWorksSteps.map((step, idx) => {
              const Icon = step.icon
              return (
                <div key={step.step} className="relative text-center">
                  {/* Connector line (hidden on first card and on mobile) */}
                  {idx > 0 && (
                    <div className="absolute -left-4 top-8 hidden h-0.5 w-8 bg-[#DBEAFE] lg:block" />
                  )}
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                    <Icon className="h-7 w-7" />
                  </div>
                  <span className="mb-1 inline-block rounded-full bg-[#2563EB] px-3 py-0.5 text-xs font-bold text-white">
                    Step {step.step}
                  </span>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ====== IMPORTANT CALLOUT ====== */}
      <section className="py-4">
        <div className="mx-auto max-w-3xl px-6">
          <div className="flex gap-4 rounded-2xl border border-blue-200 bg-[#DBEAFE] p-6">
            <Info className="mt-0.5 h-6 w-6 flex-shrink-0 text-[#2563EB]" />
            <div>
              <h3 className="font-semibold text-[#1D4ED8]">BidClaw is a QuickCalc Add-On</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                BidClaw is designed to work hand-in-hand with BlueQuickCalc. It uses your QuickCalc
                company profile, labor rates, and markup settings to produce estimates that match
                your real-world numbers. A BlueQuickCalc subscription is required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====== PRICING / CTA ====== */}
      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-2xl px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <h2 className="text-2xl font-bold text-slate-900">
              BidClaw + BlueQuickCalc Bundle
            </h2>
            <div className="mt-4">
              <span className="text-5xl font-extrabold text-[#2563EB]">$599</span>
              <span className="text-lg text-slate-500">/month</span>
            </div>
            <ul className="mx-auto mt-6 max-w-md space-y-3 text-left text-sm text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#0EA5E9]" />
                Full BlueQuickCalc access — estimating, proposals, and reporting
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#0EA5E9]" />
                BidClaw AI Estimating Engine — plan upload, AI takeoff, and QuickCalc integration
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#0EA5E9]" />
                Unlimited estimates and projects
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#0EA5E9]" />
                Priority support and onboarding assistance
              </li>
            </ul>
            <a
              href="https://bluequickcalc.com/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-block rounded-xl bg-[#2563EB] px-8 py-3 text-sm font-semibold text-white shadow transition-colors hover:bg-[#1D4ED8]"
            >
              Get Started
            </a>
          </div>
        </div>
      </section>

      {/* ====== LOGIN SECTION ====== */}
      <section className="py-16">
        <div className="mx-auto max-w-md px-6">
          <p className="mb-6 text-center text-sm text-slate-500">
            Already have BidClaw access? Log in below.
          </p>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
            {resetSent ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                  <Send className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-[#1D4ED8]">Check your email</h2>
                <p className="mt-2 text-sm text-slate-500">
                  We sent a password reset link to <strong>{email}</strong>.
                </p>
                <button
                  onClick={() => {
                    setShowReset(false)
                    setResetSent(false)
                  }}
                  className="mt-6 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  Back to sign in
                </button>
              </div>
            ) : showReset ? (
              <div>
                <h2 className="mb-2 text-center text-lg font-semibold text-[#1D4ED8]">
                  Reset Password
                </h2>
                <p className="mb-6 text-center text-sm text-slate-500">
                  Enter your email and we will send you a reset link.
                </p>
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
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
                  <button
                    onClick={() => {
                      setShowReset(false)
                      setError(null)
                    }}
                    className="font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    Back to sign in
                  </button>
                </p>
              </div>
            ) : signUpSuccess ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                  <Send className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-[#1D4ED8]">Check your email</h2>
                <p className="mt-2 text-sm text-slate-500">
                  We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
                  account.
                </p>
                <button
                  onClick={() => {
                    setIsSignUp(false)
                    setSignUpSuccess(false)
                  }}
                  className="mt-6 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <h2 className="mb-6 text-center text-xl font-bold text-[#1D4ED8]">
                  {isSignUp ? 'Create Account' : 'Welcome Back'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
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
                    onClick={() => {
                      setIsSignUp(!isSignUp)
                      setError(null)
                    }}
                    className="font-medium text-[#2563EB] hover:text-[#1D4ED8]"
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
                      className="text-xs text-slate-400 hover:text-[#2563EB]"
                    >
                      Forgot your password?
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <Footer />
    </div>
  )
}
