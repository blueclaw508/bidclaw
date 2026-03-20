import { ExternalLink, ArrowRight, DollarSign, Users, Clock, TrendingUp, Gauge, Info } from 'lucide-react'
import { PageLayout, CardSection } from '@/components/PageLayout'

export default function AboutKYN() {
  return (
    <PageLayout
      icon={<Info size={24} />}
      title="About KYN"
      subtitle="Know Your Numbers — the pricing methodology behind BidClaw & BlueQuickCalc"
    >
      <div className="space-y-6">
        {/* Ian McCarthy Quote */}
        <blockquote className="rounded-xl border-l-4 border-[#1e40af] bg-blue-50 px-6 py-5">
          <p className="text-base italic leading-relaxed text-slate-700">
            &ldquo;Most contractors don&rsquo;t go out of business because they can&rsquo;t do the work.
            They go out of business because they don&rsquo;t know their numbers.&rdquo;
          </p>
          <footer className="mt-3 text-sm font-medium text-[#1e40af]">
            &mdash; Ian McCarthy, Founder of Blue Claw Group
          </footer>
        </blockquote>

        {/* What Is KYN */}
        <CardSection icon={<DollarSign size={18} />} title="What Is KYN?" subtitle="The foundation of profitable contracting">
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
        </CardSection>

        {/* Pipeline Diagram */}
        <CardSection icon={<ArrowRight size={18} />} title="The Pipeline" subtitle="From numbers to profitable jobs">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { label: 'KYN', sub: 'Know Your Numbers', color: 'bg-slate-800 text-white' },
              { label: 'BidClaw', sub: 'AI Estimating', color: 'bg-[#1e40af] text-white' },
              { label: 'BlueQuickCalc', sub: 'Pricing Engine', color: 'bg-emerald-600 text-white' },
              { label: 'Profitable Job', sub: 'Real Margins', color: 'bg-amber-500 text-white' },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-3">
                <div className={`rounded-lg px-5 py-3 text-center ${step.color}`}>
                  <div className="text-sm font-bold">{step.label}</div>
                  <div className="text-[10px] opacity-80">{step.sub}</div>
                </div>
                {i < arr.length - 1 && <ArrowRight size={20} className="text-slate-300 shrink-0" />}
              </div>
            ))}
          </div>
        </CardSection>

        {/* Why Most Contractors Price Wrong */}
        <CardSection icon={<TrendingUp size={18} />} title="Why Most Contractors Price Wrong" subtitle="Three dangerous pricing methods">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: 'The Gut Method', desc: '"I just know what to charge." This works until a job goes sideways and you realize you lost money.' },
              { title: 'The Copycat', desc: '"I charge what my competitor charges." But you have no idea if they are profitable either.' },
              { title: 'The Multiplier', desc: '"I take materials and double it." This ignores labor burden, overhead, and every job-specific variable.' },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h4 className="mb-1 text-sm font-semibold text-red-700">{item.title}</h4>
                <p className="text-xs leading-relaxed text-red-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardSection>

        {/* Key KYN Concepts */}
        <CardSection icon={<Gauge size={18} />} title="Key KYN Concepts" subtitle="The numbers that matter">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: <DollarSign size={20} />, title: 'Labor Burden', desc: 'The true cost of an employee beyond their hourly wage: payroll taxes, workers\' comp, insurance, PTO, and more. Most contractors underestimate this by 20-40%.' },
              { icon: <Gauge size={20} />, title: 'Efficiency Rating', desc: 'What percentage of paid time is actually billable? Travel, breaks, setup, and downtime eat into your productive hours. KYN measures this so you can price for it.' },
              { icon: <TrendingUp size={20} />, title: 'Overhead Per Hour', desc: 'Your total annual overhead (rent, trucks, insurance, office, software) divided by your total billable hours. This is the baseline cost of showing up.' },
              { icon: <Users size={20} />, title: 'Revenue Per Hour (RPR)', desc: 'The all-in rate you must charge per man-hour to cover labor burden, overhead, and your target profit. This is the number that builds your business.' },
              { icon: <Clock size={20} />, title: 'Production Rates', desc: 'How long each task actually takes your crew, measured in hours per unit. BidClaw uses your production rates to generate accurate labor estimates.' },
            ].map((concept) => (
              <div key={concept.title} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <div className="mt-0.5 shrink-0 text-[#1e40af]">{concept.icon}</div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">{concept.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{concept.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardSection>

        {/* The Promise */}
        <div className="rounded-xl border border-[#1e40af]/20 bg-blue-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-slate-800">
            The KYN + BidClaw + BlueQuickCalc Promise
          </h3>
          <p className="text-sm leading-relaxed text-slate-600">
            When you know your numbers, every estimate becomes a decision rooted in data. <strong>BidClaw</strong> reads
            your plans and generates accurate takeoffs. <strong>BlueQuickCalc</strong> applies your KYN-calculated rates
            to produce a price that covers your costs and hits your profit target. Together, they give you the confidence
            to bid on bigger jobs, walk away from bad ones, and grow a business that actually makes money.
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a href="https://blueclawgroup.com/know-your-numbers" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
            Learn More About KYN <ExternalLink size={14} />
          </a>
          <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e40af] px-6 py-3 text-sm font-medium text-white hover:bg-[#1e3a8a] transition-colors">
            Go to BlueQuickCalc <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </PageLayout>
  )
}
