import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  /** Max width of the modal card. Defaults to 32rem (max-w-lg). */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

/**
 * Branded modal shell. Centered card on a semi-opaque navy backdrop.
 * Closes on Escape, outside click, or the X button. Locks body scroll
 * while open. Initial focus moves to the first focusable element.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'lg',
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

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
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className={cn(
          'relative z-10 w-full overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl',
          SIZE_CLASSES[size]
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-brand-border bg-brand-surface px-6 py-4">
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
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
