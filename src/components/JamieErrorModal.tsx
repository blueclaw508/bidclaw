// JamieErrorModal — Friendly Jamie-voiced error display
// Replaces raw error toasts with a clean modal using Jamie's voice

import { X } from 'lucide-react'

export type JamieErrorType = 'needs_info' | 'snag'

interface JamieErrorModalProps {
  isOpen: boolean
  type: JamieErrorType
  onClose: () => void
  onRetry?: () => void
}

const COPY = {
  needs_info: {
    title: "Jamie needs a bit more to go on",
    body: `I can see the project info, but I'm missing a few things to build a solid estimate. Try adding:`,
    bullets: [
      'A description of the scope in the notes field',
      'More detail on what you saw on the walkthrough',
      'A clearer plan file if the upload didn\u2019t come through',
    ],
    footer: "I work best when I know what you're thinking.",
    buttonLabel: "Got it, I'll add more",
    buttonAction: 'close' as const,
  },
  snag: {
    title: "Jamie hit a snag",
    body: "Something went wrong on my end \u2014 not yours.",
    bullets: [],
    footer: "Give it a moment and try again. If it keeps happening, refresh the page.",
    buttonLabel: "Try Again",
    buttonAction: 'retry' as const,
  },
}

export function JamieErrorModal({ isOpen, type, onClose, onRetry }: JamieErrorModalProps) {
  if (!isOpen) return null

  const copy = COPY[type]

  const handleButton = () => {
    if (copy.buttonAction === 'retry' && onRetry) {
      onRetry()
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/jamie-avatar.png"
              alt="Jamie"
              className="h-10 w-10 rounded-full object-cover"
            />
            <h3 className="text-lg font-bold text-blue-900">{copy.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="mb-6 text-sm text-slate-600 leading-relaxed">
          <p className="mb-3">{copy.body}</p>
          {copy.bullets.length > 0 && (
            <ul className="mb-3 space-y-1.5 pl-1">
              {copy.bullets.map((bullet, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">&bull;</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
          {copy.footer && <p className="text-slate-500 italic">{copy.footer}</p>}
        </div>

        {/* Button */}
        <button
          onClick={handleButton}
          className="w-full rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
        >
          {copy.buttonLabel}
        </button>
      </div>
    </div>
  )
}
