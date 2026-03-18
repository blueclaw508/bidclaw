import { useState } from 'react'
import { Trash2 } from 'lucide-react'

interface ConfirmDeleteProps {
  onConfirm: () => void
  size?: number
}

export function ConfirmDelete({ onConfirm, size = 16 }: ConfirmDeleteProps) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            onConfirm()
            setConfirming(false)
          }}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive text-white hover:bg-destructive/90"
        >
          Delete
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground hover:bg-border"
        >
          No
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-muted-foreground hover:text-destructive"
      aria-label="Delete item"
    >
      <Trash2 size={size} />
    </button>
  )
}
