import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBadge,
  Gauge,
  Layers,
  LogIn,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Zap,
} from 'lucide-react'

// QC's hero YouTube video — reused per Ian's decision. Same video, BC branding.
const HERO_YT_ID = 'iC3X-d3bfcU'

/* ============================================================
 * Small building blocks
 * ============================================================ */

function HeroYouTube() {
  const [playing, setPlaying] = useState(false)
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
      style={{ aspectRatio: '16/9' }}
    >
      {playing ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube.com/embed/${HERO_YT_ID}?autoplay=1&rel=0`}
          title="See how BidClaw works in under 3 minutes"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 h-full w-full cursor-pointer"
          aria-label="Play hero video"
        >
          <img
            src={`https://img.youtube.com/vi/${HERO_YT_ID}/maxresdefault.jpg`}
            alt="Watch BidClaw in action"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#C9A84C] text-white shadow-lg transition-transform group-hover:scale-110 sm:h-20 sm:w-20">
              <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
            </span>
          </span>
        </button>
      )}
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-start rounded-xl border border-brand-border bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-navy hover:shadow-[0_8px_24px_rgba(0,50,161,0.12)]">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-navy/10 text-brand-navy">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-brand-text">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-brand-text-muted">{body}</p>
    </div>
  )
}

function JamieValueCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-start rounded-xl border border-brand-gold/40 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-gold hover:shadow-[0_8px_24px_rgba(201,168,76,0.18)]">
      <div
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg text-white"
        style={{ background: 'linear-gradient(135deg, #C9A84C 0%, #A8872E 100%)' }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-brand-text">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-brand-text-muted">{body}</p>
    </div>
  )
}

function PricingCard({
  tier,
  price,
  perMonth,
  description,
  features,
  ctaLabel,
  variant,
  popular,
  onCta,
}: {
  tier: string
  price: string
  perMonth: string
  description: string
  features: string[]
  ctaLabel: string
  variant: 'free' | 'pro' | 'ai_pro'
  popular?: boolean
  onCta: () => void
}) {
  const topBar =
    variant === 'free'
      ? 'bg-brand-green'
      : variant === 'pro'
        ? 'bg-brand-gold'
        : 'bg-brand-navy'

  const ctaClasses =
    variant === 'pro'
      ? 'bg-brand-gold text-white hover:bg-brand-gold-dark'
      : variant === 'ai_pro'
        ? 'bg-brand-navy text-white hover:bg-brand-navy-dark'
        : 'bg-brand-text text-white hover:bg-black'

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white shadow-sm ${
        popular
          ? 'border-brand-gold shadow-[0_10px_30px_rgba(201,168,76,0.18)] lg:scale-[1.03]'
          : 'border-brand-border'
      }`}
    >
      <div className={`h-1.5 rounded-t-2xl ${topBar}`} />
      {popular && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow"
          style={{ background: 'linear-gradient(135deg, #C9A84C 0%, #A8872E 100%)' }}
        >
          Popular
        </span>
      )}
      <div className="flex flex-1 flex-col p-7">
        <h3 className="text-lg font-bold tracking-tight text-brand-text">{tier}</h3>
        <p className="mt-1 text-sm text-brand-text-muted">{description}</p>
        <div className="mt-5 flex items-end gap-1">
          <span
            className="text-5xl font-extrabold tracking-tight text-brand-navy"
            style={{ lineHeight: 1 }}
          >
            {price}
          </span>
          <span className="pb-1 text-sm font-semibold text-brand-text-muted">
            {perMonth}
          </span>
        </div>

        <ul className="mt-6 flex-1 space-y-2.5 text-sm text-brand-text">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onCta}
          className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition-colors ${ctaClasses}`}
        >
          {ctaLabel}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ============================================================
 * PromoScreen — public marketing page
 * ============================================================ */

export function PromoScreen() {
  const { status, user, sendMagicLink, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const loginRef = useRef<HTMLDivElement>(null)

  // ── Login section state (unchanged behavior from Phase 1) ──
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const callbackState = (location.state ?? {}) as {
    allowlistRejected?: boolean
    linkInvalid?: boolean
  }
  const [bounceMessage, setBounceMessage] = useState<string | null>(null)
  useEffect(() => {
    if (callbackState.allowlistRejected) {
      setBounceMessage(
        'That email is not authorized for BidClaw during the Phase 1 lockdown. You’ve been signed out.'
      )
      navigate(location.pathname, { replace: true })
    } else if (callbackState.linkInvalid) {
      setBounceMessage(
        'That sign-in link is no longer valid — it may have expired or been used already. Request a new one.'
      )
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers ──
  const scrollToLogin = () => {
    loginRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const err = await sendMagicLink(email)
    if (err) setError(err)
    else setSent(true)
    setLoading(false)
  }

  const goToApp = () => navigate('/app/projects')

  const handleSignOutFromMarketing = async () => {
    await signOut()
    setSent(false)
    setEmail('')
  }

  /* ============================================================
   * Render
   * ============================================================ */

  return (
    <div className="min-h-screen bg-white text-brand-text">
      {/* ===================== HEADER ===================== */}
      <header className="sticky top-0 z-40 border-b border-brand-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
          <a href="/" className="flex items-center gap-2.5">
            <img
              src="/bidclaw-logo.png"
              alt="BidClaw"
              className="h-10 w-10 rounded-md object-contain"
            />
            <span className="text-xl font-extrabold tracking-tight text-brand-navy">
              BidClaw
            </span>
          </a>
          <button
            type="button"
            onClick={scrollToLogin}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-dark"
          >
            Try for Free / Sign In
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ===================== HERO ===================== */}
      <section
        className="relative overflow-hidden"
        style={{
          background:
            'linear-gradient(145deg, #001A6E 0%, #0032A1 60%, #3A5FC8 100%)',
        }}
      >
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-[#C9A84C]/15 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
              Built by Contractors, for Contractors
            </p>
            <h1
              className="mt-5 font-extrabold tracking-tight text-white"
              style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', lineHeight: 1.05 }}
            >
              Stop Guessing.
              <br />
              Start Estimating.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-blue-100 sm:text-lg">
              BidClaw is the fastest way for landscaping contractors to build
              accurate, professional estimates — right from your phone, tablet,
              or desktop. No spreadsheets. No guesswork. Just real numbers.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={scrollToLogin}
                className="inline-flex items-center gap-2 rounded-md bg-[#C9A84C] px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-black/20 transition-all hover:bg-[#A8872E] hover:shadow-xl"
              >
                Try for Free / Sign In
                <ArrowRight className="h-5 w-5" />
              </button>
              <p className="text-xs text-blue-200/80">
                No credit card required. Free tier is forever free.
              </p>
            </div>

            <p className="mt-6 text-sm text-blue-200/70">
              Learn more about our firm and services at{' '}
              <a
                href="https://www.blueclawgroup.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-white underline-offset-4 hover:underline"
              >
                blueclawgroup.com
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ===================== HERO VIDEO ===================== */}
      <section className="border-b border-brand-border bg-brand-surface py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-8">
          <HeroYouTube />
          <p className="mt-5 text-center text-sm font-semibold text-brand-text-muted">
            See how BidClaw works in under 3 minutes
          </p>
        </div>
      </section>

      {/* ===================== WHY LANDSCAPERS LOVE BIDCLAW ===================== */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <header className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
              Why Landscapers Love BidClaw
            </h2>
          </header>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={Zap}
              title="Estimates in Minutes"
              body="Build detailed, multi-area estimates faster than any spreadsheet."
            />
            <FeatureCard
              icon={Gauge}
              title="Know Your Numbers"
              body="Dial in your labor rates, overhead, and profit margins — so every bid is profitable."
            />
            <FeatureCard
              icon={FileBadge}
              title="Professional PDFs"
              body="Send branded, client-ready proposals with one tap. No awkward email chains."
            />
            <FeatureCard
              icon={ThumbsUp}
              title="Client Approvals"
              body="Clients approve estimates online. Track status in real time."
            />
          </div>
        </div>
      </section>

      {/* ===================== BRAD LEA BAND ===================== */}
      <section
        className="border-y border-white/5 py-12"
        style={{ background: 'linear-gradient(180deg, #001A6E 0%, #002080 100%)' }}
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 text-center sm:px-8 md:flex-row md:justify-center md:gap-10 md:text-left">
          <p
            className="text-xs font-bold uppercase tracking-[0.18em] md:text-sm"
            style={{ color: '#C9A84C' }}
          >
            As Seen On Dropping Bombs with Brad Lea!
          </p>
          <a
            href="https://youtu.be/r9hLn1XKE_E"
            target="_blank"
            rel="noopener noreferrer"
            className="block flex-shrink-0 overflow-hidden rounded-lg border border-white/15 shadow-lg transition-all hover:border-[#C9A84C]/60 hover:shadow-[0_8px_24px_rgba(201,168,76,0.25)]"
          >
            <img
              src="/ian-brad-lea.jpg"
              alt="Ian McCarthy with Brad Lea on Dropping Bombs podcast"
              className="h-32 w-44 object-cover"
            />
          </a>
        </div>
      </section>

      {/* ===================== JAMIE SECTION (NEW) ===================== */}
      <section className="relative py-20 sm:py-24" style={{ background: '#FFFCF1' }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <header className="mx-auto max-w-2xl text-center">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow"
              style={{
                background: 'linear-gradient(135deg, #C9A84C 0%, #A8872E 100%)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              New
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
              Meet Jamie. Your AI Estimating Partner.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-brand-text-muted sm:text-lg">
              Upload your plans. Jamie reads them, asks the right questions,
              and builds a complete proposal — work areas, scope, line items,
              pricing — using your own catalog and labor rates.
            </p>
          </header>

          <div className="mx-auto mt-12 max-w-4xl">
            <div
              className="relative overflow-hidden rounded-2xl border border-brand-gold/40 bg-black shadow-xl"
              style={{ aspectRatio: '16/9' }}
            >
              <video
                src="/jamie-intro.mp4"
                controls
                playsInline
                preload="metadata"
                poster="/jamie-avatar.png"
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            <JamieValueCard
              icon={Layers}
              title="Plans In, Proposals Out"
              body="Jamie does the takeoff, scope, and pricing work that used to eat your evenings."
            />
            <JamieValueCard
              icon={Database}
              title="Built on Your Numbers"
              body="Pulls from your catalog, your rates, your markups — no generic AI guessing."
            />
            <JamieValueCard
              icon={ShieldCheck}
              title="You're Always In Control"
              body="Review, edit, and approve every line. Jamie proposes, you decide."
            />
          </div>
        </div>
      </section>

      {/* ===================== $12M SECTION ===================== */}
      <section className="border-y border-brand-border bg-brand-surface py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-8">
          <h2 className="text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
            Built by a <span className="text-brand-navy">$12M</span> Landscaping Company
          </h2>
          <p className="mt-6 text-base leading-relaxed text-brand-text sm:text-lg">
            BidClaw was built by Blue Claw Associates — a Cape Cod landscaping
            company that grew to $12 million a year. We know the estimating
            struggle firsthand: too many spreadsheets, too many missed margins,
            too much time wasted on bids that should take minutes, not hours.
          </p>
          <p className="mt-5 text-base leading-relaxed text-brand-text sm:text-lg">
            So we built the tool we always wished we had. BidClaw lets you plug
            in your real numbers — labor burden, equipment rates, overhead,
            profit targets — and instantly produce accurate estimates your
            clients will take seriously. Whether you are a solo operator or
            running multiple crews, BidClaw scales with you.
          </p>

          {/* Stats row */}
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-6">
            <div>
              <div
                className="text-3xl font-extrabold text-brand-navy sm:text-4xl"
                style={{ lineHeight: 1 }}
              >
                $12M+
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-brand-text-muted">
                Revenue Built
              </div>
            </div>
            <div>
              <div
                className="text-3xl font-extrabold text-brand-navy sm:text-4xl"
                style={{ lineHeight: 1 }}
              >
                6.5 yrs
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-brand-text-muted">
                To Build It
              </div>
            </div>
            <div>
              <div
                className="text-3xl font-extrabold text-brand-navy sm:text-4xl"
                style={{ lineHeight: 1 }}
              >
                30 yrs
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-brand-text-muted">
                Experience
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={scrollToLogin}
            className="mt-10 inline-flex items-center gap-2 rounded-md bg-brand-navy px-7 py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-brand-navy-dark"
          >
            Start Building Today
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* ===================== PRICING ===================== */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <header className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
              Start Free. Upgrade When You're Ready.
            </h2>
            <p className="mt-4 text-base text-brand-text-muted sm:text-lg">
              No credit card. No commitment. Start free with 5 estimates a
              month. Step up to Pro for unlimited estimates, projects, and
              QuickBooks sync — or AI Pro to let Jamie handle the estimating.
            </p>
          </header>

          <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
            <PricingCard
              variant="free"
              tier="Free"
              price="$0"
              perMonth="Forever free"
              description="Build estimates the manual way. Perfect for getting started."
              features={[
                '5 estimates per month',
                'Item catalog',
                'Manual pricing & markups',
                'Mobile-friendly',
                'Professional PDF proposals',
              ]}
              ctaLabel="Start Free"
              onCta={scrollToLogin}
            />
            <PricingCard
              variant="pro"
              popular
              tier="Pro"
              price="$39"
              perMonth="/ month"
              description="Everything you need to run jobs end-to-end."
              features={[
                'Everything in Free, plus:',
                'Unlimited estimates',
                'Plan upload + measuring tool',
                'Project workspace',
                'Client approvals + e-sign',
                'Branded PDF proposals',
                'QuickBooks sync',
                'WIP accounting',
              ]}
              ctaLabel="Start Pro Trial"
              onCta={scrollToLogin}
            />
            <PricingCard
              variant="ai_pro"
              tier="AI Pro"
              price="$199"
              perMonth="/ month"
              description="Let Jamie handle the estimating."
              features={[
                'Everything in Pro, plus:',
                'Jamie AI plan reading',
                'AI-generated proposals',
                'AI takeoff',
                'Priority support',
              ]}
              ctaLabel="Try AI Pro"
              onCta={scrollToLogin}
            />
          </div>
        </div>
      </section>

      {/* ===================== LOGIN SECTION (PRESERVED FROM PHASE 1) ===================== */}
      <section
        ref={loginRef}
        className="px-6 py-16 sm:px-8 lg:py-20"
        style={{
          background:
            'linear-gradient(180deg, #001A6E 0%, #0032A1 50%, #002080 100%)',
        }}
      >
        <div className="mx-auto w-full max-w-sm">
          {status === 'authenticated' ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-white">You're signed in</h2>
              <p className="mt-2 text-sm text-blue-100">
                Welcome back, <strong className="text-white">{user?.email}</strong>.
              </p>
              <button
                type="button"
                onClick={goToApp}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#C9A84C] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#A8872E]"
              >
                Go to your projects
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleSignOutFromMarketing}
                className="mt-3 text-xs font-medium text-blue-200 hover:text-white"
              >
                Sign out
              </button>
            </div>
          ) : sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white">
                <Send className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-white">Check your email</h2>
              <p className="mt-2 text-sm text-blue-100">
                We sent a sign-in link to{' '}
                <strong className="text-white">{email}</strong>. Click it to
                finish signing in.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSent(false)
                  setError(null)
                }}
                className="mt-6 text-sm font-medium text-blue-200 hover:text-white"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 className="mb-1 text-center text-2xl font-bold text-white">
                Welcome back
              </h2>
              <p className="mb-8 text-center text-sm text-blue-100">
                Enter your email and we'll send you a sign-in link.
              </p>

              {bounceMessage && (
                <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-300/40 bg-red-500/15 p-3">
                  <AlertCircle
                    size={16}
                    className="mt-0.5 flex-shrink-0 text-red-200"
                  />
                  <p className="text-xs leading-relaxed text-red-50">
                    {bounceMessage}
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-blue-100">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-blue-200/60 focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/30"
                    placeholder="you@company.com"
                    autoFocus
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#C9A84C] py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-[#A8872E] hover:shadow-xl disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  {loading ? 'Sending link…' : 'Send me a sign-in link'}
                </button>
              </form>

              {/* Phase 1 lockdown note — INTENTIONALLY does not name the
                  allowlisted email. Disclosing the email here would tell
                  every visitor exactly which account has system access. */}
              <div className="mt-8 flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
                <ClipboardCheck
                  size={16}
                  className="mt-0.5 flex-shrink-0 text-[#C9A84C]"
                />
                <p className="text-xs leading-relaxed text-blue-100">
                  BidClaw is in private Phase 1 testing. Open access arrives in
                  a later phase. For early-access inquiries, contact{' '}
                  <a
                    href="mailto:info@blueclawgroup.com"
                    className="font-semibold text-white underline-offset-4 hover:underline"
                  >
                    info@blueclawgroup.com
                  </a>
                  .
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="bg-[#001A6E] text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-8">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
            {/* Left — Brand */}
            <div>
              <div className="flex items-center gap-2.5">
                <img
                  src="/bidclaw-logo.png"
                  alt="BidClaw"
                  className="h-10 w-10 rounded-md object-contain"
                />
                <span className="text-xl font-extrabold tracking-tight text-white">
                  BidClaw
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-blue-200">
                A product of The Blue Claw Group — helping landscapers run
                smarter, more profitable businesses through better systems and
                real numbers.
              </p>
              <a
                href="https://www.blueclawgroup.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#C9A84C] hover:text-white"
              >
                www.blueclawgroup.com
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>

            {/* Middle — Get in Touch */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#C9A84C]">
                Get in Touch
              </h3>
              <ul className="mt-4 space-y-2.5 text-sm text-blue-100">
                <li>
                  <a
                    href="mailto:info@blueclawgroup.com"
                    className="hover:text-white"
                  >
                    info@blueclawgroup.com
                  </a>
                </li>
                <li>
                  <a href="tel:+15089869998" className="hover:text-white">
                    508-986-9998
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.blueclawgroup.com/know-your-numbers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    Take the Know Your Numbers online course
                  </a>
                </li>
              </ul>
            </div>

            {/* Right — empty (reserved for future links) — keeps grid balance */}
            <div className="hidden md:block" />
          </div>

          <div className="mt-12 border-t border-white/10 pt-6 text-center text-xs text-blue-200/70">
            © {new Date().getFullYear()} The Blue Claw Group. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
