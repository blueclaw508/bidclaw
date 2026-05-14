import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' uses a red confirm button; 'primary' uses navy. */
  tone?: 'primary' | 'danger'
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} size="md">
      <div className="text-sm leading-relaxed text-brand-text-muted">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50',
            tone === 'danger'
              ? 'bg-rose-600 hover:bg-rose-700'
              : 'bg-brand-navy hover:bg-brand-navy-dark'
          )}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
