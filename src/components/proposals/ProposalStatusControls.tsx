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
  presented: {
    tint: 'border-blue-200 bg-blue-50 text-blue-700',
    revertButton: 'border-blue-200 text-blue-700 hover:bg-blue-100',
    icon: Send,
    message: 'This proposal is marked as presented. Inline edits are locked.',
  },
  accepted: {
    tint: 'border-green-200 bg-green-50 text-green-700',
    revertButton: 'border-green-200 text-green-700 hover:bg-green-100',
    icon: CircleCheck,
    message: 'This proposal is marked as accepted. Inline edits are locked.',
  },
  declined: {
    tint: 'border-rose-200 bg-rose-50 text-rose-700',
    revertButton: 'border-rose-200 text-rose-700 hover:bg-rose-100',
    icon: CircleX,
    message: 'This proposal is marked as declined. Inline edits are locked.',
  },
  completed: {
    tint: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    revertButton: 'border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    icon: CircleCheck,
    message:
      'This proposal is marked as completed — wrapped up successfully. Inline edits are locked.',
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
  if (to === 'presented') {
    return (
      <>
        Mark this proposal as presented to the client? Inline editing will
        be locked. You can still refresh totals or delete the proposal, and
        you can revert to draft at any time.
      </>
    )
  }
  if (to === 'accepted') {
    return (
      <>
        Mark this proposal as accepted? The proposal stays locked from
        inline edits. You can advance to completed when the work is done,
        or revert to draft to rework.
      </>
    )
  }
  if (to === 'declined') {
    return (
      <>
        Mark this proposal as declined? The proposal stays locked from
        inline edits. You can revert to draft to rework and re-present.
      </>
    )
  }
  if (to === 'completed') {
    return (
      <>
        Mark this proposal as completed — work delivered and accepted by
        the client? You can reopen back to accepted or revert to draft if
        needed.
      </>
    )
  }
  if (to === 'draft') {
    return (
      <>
        Revert this proposal to draft? Inline editing will be unlocked.
        The proposal stays attached to the same project; no data is lost.
      </>
    )
  }
  return <>Change status from {from} to {to}?</>
}
