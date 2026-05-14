import { Link } from 'react-router-dom'

/**
 * Persistent footer below every /app/* route. Branded chrome that ties
 * the in-app shell to the marketing page visually — not a marketing
 * pitch (the user is already in).
 */
export function MarketingBar() {
  return (
    <footer className="mt-auto border-t border-brand-border bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-2 px-6 py-4 text-xs sm:flex-row">
        <div className="flex items-center gap-2 font-semibold text-brand-navy">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-gold" aria-hidden="true" />
          BidClaw Pro
        </div>

        <p className="hidden text-brand-text-muted sm:block">
          Know Your Numbers. Run a better business.
        </p>

        <div className="flex items-center gap-4 text-brand-text-muted">
          <Link
            to="/"
            className="transition-colors hover:text-brand-navy"
          >
            Marketing page
          </Link>
          <span aria-hidden="true" className="text-brand-border">·</span>
          <span
            className="cursor-not-allowed opacity-60"
            title="Coming soon"
          >
            Help
          </span>
        </div>
      </div>
    </footer>
  )
}
