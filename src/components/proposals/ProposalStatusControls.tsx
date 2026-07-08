import { useEffect } from 'react'
import {
  ChevronDown,
  CircleCheck,
  CircleX,
  Lock,
  Send,
} from 'lucide-react'
import { PROPOSAL_STATUS_CONFIG } from '@/lib/statusConfig'
import type { StatusTransition } from '@/lib/proposals'
import type { ProposalStatus } from '@/lib/types'

/**
 * Status lifecycle UI for the proposal editor, extracted from
 * ProposalEditor (P1-D cleanup 3):
 *
 *   • StatusBanner — status-tinted locked-editing bar with a quick
 *     "Revert to draft" CTA. Rendered when status != 'draft'.
 *   • StatusMenu — toolbar "Status: {label} ▾" dropdown of available
 *     transitions per availableTransitions().
 *   • transitionDescription — ConfirmDialog body copy per transition.
 *
 * Status display labels come from PROPOSAL_STATUS_CONFIG (the editor's
 * old local STATUS_LABEL map was a verbatim copy of it).
 */

export function StatusBanner({
  status,
  onRevertToDraft,
}: {
  status: ProposalStatus
  onRevertToDraft: () => void
}) {
  const cfg = STATUS_BANNER_CONFIG[status]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${cfg.tint}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{cfg.message}</span>
      </div>
      <button
        type="button"
        onClick={onRevertToDraft}
        className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-semibold transition-colors ${cfg.revertButton}`}
      >
        Revert to draft
      </button>
    </div>
  )
}

// Shown once a proposal leaves the editable prep stages (draft /
// ready_to_send). Draft + Ready to Send have no banner — they're editable.
const STATUS_BANNER_CONFIG: Partial<
  Record<
    ProposalStatus,
    {
      tint: string
      revertButton: string
      icon: typeof Lock
      message: string
    }
  >
> = {
  sent: {
    tint: 'border-blue-200 bg-blue-50 text-blue-700',
    revertButton: 'border-blue-200 text-blue-700 hover:bg-blue-100',
    icon: Send,
    message: 'This proposal is marked Sent. Inline edits are locked.',
  },
  approved: {
    tint: 'border-green-200 bg-green-50 text-green-700',
    revertButton: 'border-green-200 text-green-700 hover:bg-green-100',
    icon: CircleCheck,
    message: 'This proposal is marked Approved. Inline edits are locked.',
  },
  in_progress: {
    tint: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    revertButton: 'border-indigo-200 text-indigo-700 hover:bg-indigo-100',
    icon: Lock,
    message: 'This proposal is marked In Progress. Inline edits are locked.',
  },
  completed: {
    tint: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    revertButton: 'border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    icon: CircleCheck,
    message: 'This proposal is marked Completed. Inline edits are locked.',
  },
  lost: {
    tint: 'border-rose-200 bg-rose-50 text-rose-700',
    revertButton: 'border-rose-200 text-rose-700 hover:bg-rose-100',
    icon: CircleX,
    message: 'This proposal is marked Lost. Inline edits are locked.',
  },
}

export function StatusMenu({
  status,
  transitions,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  status: ProposalStatus
  transitions: StatusTransition[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (t: StatusTransition) => void
}) {
  // Click-outside close: clicking anywhere besides the menu closes it.
  useEffect(() => {
    if (!open) return
    const handler = () => onClose()
    // Defer one tick so the toggle click that opened us doesn't immediately close.
    const id = window.setTimeout(() => {
      window.addEventListener('click', handler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', handler)
    }
  }, [open, onClose])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <Lock className="h-4 w-4" />
        Status: {PROPOSAL_STATUS_CONFIG[status].label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          {transitions.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-gray-500">
              No transitions available.
            </div>
          ) : (
            <ul className="py-1">
              {transitions.map((t) => (
                <li key={t.target}>
                  <button
                    type="button"
                    onClick={() => onSelect(t)}
                    className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                      t.tone === 'primary'
                        ? 'font-semibold text-brand-navy hover:bg-blue-50'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ConfirmDialog body copy per (from → to) transition. Short, contractor-
 * direct; explains the side-effect when relevant (e.g. "this will lock
 * inline edits").
 */
export function transitionDescription(
  from: ProposalStatus,
  to: ProposalStatus
): React.ReactNode {
  void from
  const label = PROPOSAL_STATUS_CONFIG[to].label
  // draft + ready_to_send are the editable prep stages; everything else
  // locks inline edits (the frozen snapshot stays put).
  if (to === 'draft' || to === 'ready_to_send') {
    return (
      <>
        Set this proposal to <strong>{label}</strong>? Inline editing will be
        unlocked so you can make changes. It stays attached to the same
        project; no data is lost.
      </>
    )
  }
  return (
    <>
      Set this proposal to <strong>{label}</strong>? Inline edits will be
      locked (the frozen numbers stay put). You can set it back to Draft or
      Ready to Send anytime to rework.
    </>
  )
}
