import { ArrowLeft, MonitorSmartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * Replaces the entire measure-view layout when the viewport is too
 * narrow. The measuring tool needs at least a desktop / large-tablet
 * canvas — counting pixels under a finger on a phone is not
 * functional. Detection lives in MeasureView (window.innerWidth +
 * ResizeObserver); this component is the fallback render.
 */
interface MobileWarningProps {
  /** Path to navigate back to on the Back button. */
  backTo: string
}

export function MobileWarning({ backTo }: MobileWarningProps) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-gold-pale">
        <MonitorSmartphone className="h-7 w-7 text-brand-gold-dark" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-brand-text">
          Bigger screen needed
        </h2>
        <p className="mt-2 text-sm text-brand-text-muted">
          The measuring tool is built for desktop and larger tablets.
          Please use a screen at least <strong>1024 px wide</strong> for
          accurate measurement work.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate(backTo)}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to project
      </button>
    </div>
  )
}
