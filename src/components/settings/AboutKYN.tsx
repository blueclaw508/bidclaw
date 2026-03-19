import { ExternalLink, ArrowRight, DollarSign, Users, Clock, TrendingUp, Gauge } from 'lucide-react'

export default function AboutKYN() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800">
          Know Your Numbers &mdash; The Philosophy Behind BidClaw &amp; BlueQuickCalc
        </h2>
        <p className="mt-3 text-sm text-slate-500 italic">
          Built on decades of real-world contracting experience
        </p>
      </div>

      {/* Ian McCarthy Quote */}
      <blockquote className="rounded-lg border-l-4 border-[#2563EB] bg-blue-50 px-6 py-5">
        <p className="text-base italic leading-relaxed text-slate-700">
          &ldquo;Most contractors don&rsquo;t go out of business because they can&rsquo;t do the work.
          They go out of business because they don&rsquo;t know their numbers.&rdquo;
        </p>
        <footer className="mt-3 text-sm font-medium text-[#2563EB]">
          &mdash; Ian McCarthy, Founder of Blue Claw Group
        </footer>
      </blockquote>

      {/* What Is KYN */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-slate-800">What Is KYN?</h3>
        <p className="text-sm leading-relaxed text-slate-600">
          <strong>Know Your Numbers (KYN)</strong> is a pricing methodology designed specifically for
          service-based contractors. Instead of guessing, using gut feelings, or copying what competitors
          charge, KYN forces you to calculate your <em>actual</em> cost of doing business &mdash; and
          price every job accordingly.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          KYN accounts for labor burden, overhead, desired profit margin, and production efficiency so
          that every estimate you send is backed by real math, not hope.
        </p>
      </section>

      {/* Pipeline Diagram */}
      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-800">The Pipeline</h3>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {[
            { label: 'KYN', sub: 'Know Your Numbers', color: 'bg-slate-800 text-white' },
            { label: 'BidClaw', sub: 'AI Estimating', color: 'bg-[#2563EB] text-white' },
            { label: 'BlueQuickCalc', sub: 'Pricing Engine', color: 'bg-emerald-600 text-white' },
            { label: 'Profitable Job', sub: 'Real Margins', color: 'bg-amber-500 text-white' },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center gap-3">
              <div className={`rounded-lg px-5 py-3 text-center ${step.color}`}>
                <div className="text-sm font-bold">{step.label}</div>
                <div className="text-[10px] opacity-80">{step.sub}</div>
              </div>
              {i < arr.length - 1 && (
                <ArrowRight size={20} className="text-slate-300 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Why Most Contractors Price Wrong */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-slate-800">
          Why Most Contractors Price Wrong
        </h3>
        <p className="mb-4 text-sm text-slate-600">
          There are three common (and dangerous) ways contractors set prices:
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              title: 'The Gut Method',
              desc: '"I just know what to charge." This works until a job goes sideways and you realize you lost money.',
            },
            {
              title: 'The Copycat',
              desc: '"I charge what my competitor charges." But you have no idea if they are profitable either.',
            },
            {
              title: 'The Multiplier',
              desc: '"I take materials and double it." This ignores labor burden, overhead, and every job-specific variable.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-red-200 bg-red-50 p-4"
            >
              <h4 className="mb-1 text-sm font-semibold text-red-700">{item.title}</h4>
              <p className="text-xs leading-relaxed text-red-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Key KYN Concepts */}
      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-800">Key KYN Concepts</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: <DollarSign size={20} />,
              title: 'Labor Burden',
              desc: 'The true cost of an employee beyond their hourly wage: payroll taxes, workers\' comp, insurance, PTO, and more. Most contractors underestimate this by 20-40%.',
            },
            {
              icon: <Gauge size={20} />,
              title: 'Efficiency Rating',
              desc: 'What percentage of paid time is actually billable? Travel, breaks, setup, and downtime eat into your productive hours. KYN measures this so you can price for it.',
            },
            {
              icon: <TrendingUp size={20} />,
              title: 'Overhead Per Hour',
              desc: 'Your total annual overhead (rent, trucks, insurance, office, software) divided by your total billable hours. This is the baseline cost of showing up.',
            },
            {
              icon: <Users size={20} />,
              title: 'Revenue Per Hour (RPR)',
              desc: 'The all-in rate you must charge per man-hour to cover labor burden, overhead, and your target profit. This is the number that builds your business.',
            },
            {
              icon: <Clock size={20} />,
              title: 'Production Rates',
              desc: 'How long each task actually takes your crew, measured in hours per unit. BidClaw uses your production rates to generate accurate labor estimates.',
            },
          ].map((concept) => (
            <div
              key={concept.title}
              className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="mt-0.5 shrink-0 text-[#2563EB]">{concept.icon}</div>
              <div>
                <h4 className="text-sm font-semibold text-slate-700">{concept.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{concept.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* The Promise */}
      <section className="rounded-lg border border-[#2563EB]/20 bg-blue-50 p-6">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">
          The KYN + BidClaw + BlueQuickCalc Promise
        </h3>
        <p className="text-sm leading-relaxed text-slate-600">
          When you know your numbers, every estimate becomes a decision rooted in data. <strong>BidClaw</strong> reads
          your plans and generates accurate takeoffs. <strong>BlueQuickCalc</strong> applies your KYN-calculated rates
          to produce a price that covers your costs and hits your profit target. Together, they give you the confidence
          to bid on bigger jobs, walk away from bad ones, and grow a business that actually makes money.
        </p>
      </section>

      {/* CTA Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <a
          href="https://blueclawgroup.com/know-your-numbers"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Learn More About KYN
          <ExternalLink size={14} />
        </a>
        <a
          href="https://bluequickcalc.app"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-[#2563EB] px-6 py-3 text-sm font-medium text-white hover:bg-[#1d4ed8] transition-colors"
        >
          Go to BlueQuickCalc
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Footer / Logo placeholder */}
      <div className="border-t border-slate-200 pt-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#2563EB]/10">
          <span className="text-lg font-bold text-[#2563EB]">BC</span>
        </div>
        <p className="text-xs text-slate-400">
          BidClaw &mdash; AI-Powered Estimating for Contractors Who Know Their Numbers
        </p>
      </div>
    </div>
  )
}
