// JamieLoadingButton — Button with immediate loading feedback and rotating status messages
// Every action button in BidClaw must show feedback within one frame of clicking.

import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

const JAMIE_STATUS_MESSAGES = [
  'Jamie is reading the plan...',
  'Jamie is identifying materials...',
  'Jamie is calculating labor hours...',
  'Jamie is checking your catalog...',
  'Almost there...',
]

const ROTATE_INTERVAL = 4500 // ms between status message changes
const BIG_JOB_THRESHOLD = 8000 // ms before showing "big job" message

interface JamieLoadingButtonProps {
  defaultLabel: string
  loadingLabel: string
  loading: boolean
  disabled?: boolean
  onClick: () => void
  icon?: React.ReactNode
  className?: string
}

export function JamieLoadingButton({
  defaultLabel,
  loadingLabel,
  loading,
  disabled,
  onClick,
  icon,
  className,
}: JamieLoadingButtonProps) {
  const [statusIndex, setStatusIndex] = useState(0)
  const [showBigJob, setShowBigJob] = useState(false)
  const loadStartRef = useRef<number>(0)

  // Rotate status messages while loading
  useEffect(() => {
    if (!loading) {
      setStatusIndex(0)
      setShowBigJob(false)
      return
    }

    loadStartRef.current = Date.now()

    const rotateTimer = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % JAMIE_STATUS_MESSAGES.length)
    }, ROTATE_INTERVAL)

    const bigJobTimer = setTimeout(() => {
      setShowBigJob(true)
    }, BIG_JOB_THRESHOLD)

    return () => {
      clearInterval(rotateTimer)
      clearTimeout(bigJobTimer)
    }
  }, [loading])

  return (
    <div>
      <button
        onClick={onClick}
        disabled={loading || disabled}
        className={className ?? `inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-70 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {loadingLabel}
          </>
        ) : (
          <>
            {icon}
            {defaultLabel}
          </>
        )}
      </button>

      {/* Rotating status line + big job message */}
      {loading && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-slate-500 animate-pulse">
            {JAMIE_STATUS_MESSAGES[statusIndex]}
          </p>
          {showBigJob && (
            <p className="text-xs text-slate-400 italic">
              This one's a big job — give me a moment.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
