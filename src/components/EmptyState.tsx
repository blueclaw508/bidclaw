import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  ctaLabel?: string
  ctaDisabled?: boolean
  onCta?: () => void
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaDisabled = false,
  onCta,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center rounded-xl border border-brand-border bg-white p-10 text-center shadow-sm',
        className
      )}
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-surface text-brand-navy">
        <Icon className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-brand-text">
        {title}
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-brand-text-muted">
        {description}
      </p>
      {ctaLabel && (
        <button
          type="button"
          disabled={ctaDisabled}
          onClick={onCta}
          className={cn(
            'mt-6 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors',
            ctaDisabled
              ? 'cursor-not-allowed bg-brand-surface text-brand-text-muted'
              : 'bg-brand-navy text-white hover:bg-brand-navy-dark'
          )}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
