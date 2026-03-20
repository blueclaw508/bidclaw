import type { ReactNode } from 'react'

interface PageLayoutProps {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}

export function PageLayout({ icon, title, subtitle, children }: PageLayoutProps) {
  return (
    <div className="relative">
      {/* Watermark logos — left and right */}
      <div className="pointer-events-none fixed inset-y-0 left-0 z-0 flex items-center">
        <img
          src="/bidclaw-logo.png"
          alt=""
          className="h-[500px] w-auto -translate-x-1/3 opacity-[0.04]"
        />
      </div>
      <div className="pointer-events-none fixed inset-y-0 right-0 z-0 flex items-center">
        <img
          src="/bidclaw-logo.png"
          alt=""
          className="h-[500px] w-auto translate-x-1/3 opacity-[0.04]"
        />
      </div>

      {/* Hero banner */}
      <div className="relative -mx-6 -mt-6 mb-6 overflow-hidden rounded-b-2xl bg-gradient-to-r from-[#1e3a8a] via-[#1e40af] to-[#2563eb] px-6 py-8 shadow-lg">
        {/* Decorative glow */}
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />

        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm">
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{title}</h1>
            <p className="mt-0.5 text-sm text-blue-200">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}

interface CardSectionProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}

export function CardSection({ icon, title, subtitle, children, className = '', action }: CardSectionProps) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-[#2563EB]">{icon}</span>}
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}
