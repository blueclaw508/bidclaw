import { useEffect, useRef, useState } from 'react'

/**
 * Decimal-aware numeric input with local draft text state.
 *
 * Lifted from the inline `NumericCell` originally written in Phase 2f
 * (`ProposalLineRow.tsx`) to fix a decimal/negative input loss bug.
 * Generalized for reuse anywhere a numeric value needs to be edited
 * by hand (proposal line qty/cost, kit factors, future markup /
 * percentage / dimension inputs).
 *
 * WHY THIS EXISTS (the bug it fixes)
 * The naive pattern of `value={String(numericState)}` +
 * `onChange → Number(text) → setNumericState` breaks for partial
 * typing. After "5." the parsed value is 5; the next render forces
 * the input's displayed value back to "5"; the trailing dot is lost
 * and any decimal portion appended next gets concatenated into the
 * integer part (e.g. "4.85" → user types "5.20" → state becomes 52).
 * The same mechanism eats the leading minus in "-5": Number("-") is
 * NaN → fallback 0 → display "" → minus gone.
 *
 * THE FIX
 * Maintain a local string state that mirrors what the user is typing.
 * Commit a parsed number (or null for empty) to the parent on every
 * change; partial states like "-" / "." / "5." don't commit at all
 * so they survive until the user types more. Re-sync the local
 * string from the parent only when the EXTERNAL value diverges from
 * the last value we committed (Reset / server reload paths).
 *
 * CALLER CONTRACT
 * - `value: number | null` — `null` and `NaN` both render as empty.
 * - `onCommit(n: number | null)` — emits `null` for an empty buffer,
 *   a finite number for a parseable buffer, and **does not fire** for
 *   partial intermediate states. Callers that store NaN (e.g. for
 *   `proposal_lines.quantity` which is NOT NULL in the DB schema)
 *   should map `null → NaN` in their `onCommit` handler so validators
 *   like `!Number.isFinite(value)` keep working.
 * - Validation lives at the call site (rose border via `className`,
 *   hover tip via `title`).
 */

interface DecimalInputProps {
  /** Current external value. NaN treated the same as null. */
  value: number | null
  /** Called with the parsed number, or null for empty. Not called for partial states (e.g. "-", "."). */
  onCommit: (n: number | null) => void
  placeholder?: string
  className: string
  disabled?: boolean
  ariaLabel?: string
  /** Hover tooltip — typical use: validation error explanation. */
  title?: string
}

export default function DecimalInput({
  value,
  onCommit,
  placeholder,
  className,
  disabled,
  ariaLabel,
  title,
}: DecimalInputProps) {
  const [text, setText] = useState(() => formatForInput(value))
  // Track what we last committed so we don't fight the user mid-typing
  // when the parent re-renders with the value we just sent it.
  const lastCommitted = useRef<number | null>(normalize(value))

  // External-change re-sync: when the parent's value differs from what
  // we last committed (e.g. Reset, server reload), refresh the local
  // text to match. Tolerant numeric equality handles float noise +
  // null/NaN equivalence.
  useEffect(() => {
    const next = normalize(value)
    if (sameValue(next, lastCommitted.current)) return
    setText(formatForInput(value))
    lastCommitted.current = next
  }, [value])

  const handleChange = (raw: string) => {
    setText(raw)
    // Empty → commit null. Parent's validator (if any) can flag it.
    if (raw.trim() === '') {
      lastCommitted.current = null
      onCommit(null)
      return
    }
    // parseFloat handles "5.", "-5", ".5", and stops at the first
    // non-numeric character — so partial "5.2" returns 5.2 without
    // requiring the trailing-digit completeness Number() would demand.
    const n = parseFloat(raw)
    if (Number.isNaN(n)) {
      // Buffer isn't yet parseable (e.g. just "-" or "."). Don't fight
      // the user — leave the parent's last value intact.
      return
    }
    lastCommitted.current = n
    onCommit(n)
  }

  const handleBlur = () => {
    // Normalize "5." → "5" and ".5" → "0.5" on blur. Keeps the
    // displayed text consistent with the committed value without
    // interfering with mid-typing.
    if (text.trim() === '') return
    const n = parseFloat(text)
    if (!Number.isNaN(n)) {
      const normalized = String(n)
      if (normalized !== text) setText(normalized)
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      title={title}
      aria-label={ariaLabel}
    />
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

/** Display formatter: numeric → string for the input buffer. Empty for null/NaN/Infinity. */
function formatForInput(n: number | null): string {
  if (n === null || n === undefined) return ''
  if (!Number.isFinite(n)) return ''
  return String(n)
}

/** Coerce input to canonical (null | finite-number) — NaN and undefined both fold to null. */
function normalize(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null
  if (!Number.isFinite(n)) return null
  return n
}

/** Tolerant equality after normalize: handles null + float noise + both-zero. */
function sameValue(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) < 1e-9
}
