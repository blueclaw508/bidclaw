import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lockBodyScroll } from '@/lib/bodyScrollLock'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  /**
   * Actions pinned to the bottom of the card, outside the scrolling body.
   * A long body (Jamie's 18-line takeoff, a full invoice) used to push the
   * buttons past the bottom of the screen with no way to reach them: the
   * page behind is scroll-locked, so the only way out was to zoom the
   * browser out. Anything here stays on screen however long the body gets.
   */
  footer?: React.ReactNode
  /**
   * False when a stray click outside the card would throw away work the
   * contractor cannot cheaply get back — an AI result that cost a call, a
   * half-filled form. The X and any Cancel button still close it; only the
   * accidental exits (backdrop, Escape) are disarmed. Defaults to true.
   */
  dismissible?: boolean
  /** Max width of the modal card. Defaults to 32rem (max-w-lg). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
}

/**
 * Branded modal shell. Centered card on a semi-opaque navy backdrop.
 * Closes on the X button, and on Escape or an outside click while
 * `dismissible`. Locks body scroll while open. Initial focus moves to the
 * first focusable element.
 *
 * The card never grows past the viewport: the body scrolls inside it and
 * the header and `footer` stay put.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'lg',
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const releaseScroll = lockBodyScroll()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    window.addEventListener('keydown', onKey)

    // Move initial focus into the modal
    requestAnimationFrame(() => {
      const first = cardRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      )
      first?.focus()
    })

    return () => {
      releaseScroll()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-brand-navy-dark/40 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className={cn(
          'relative z-10 flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl',
          SIZE_CLASSES[size]
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border bg-brand-surface px-6 py-4">
          <div>
            <h2 id="modal-title" className="text-lg font-bold tracking-tight text-brand-text">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-brand-text-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-brand-text-muted hover:bg-brand-surface hover:text-brand-text"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-brand-border bg-brand-surface px-6 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
