import { useEffect, useState } from 'react'

/**
 * Shared blur-save inline-edit primitives. Used by ProjectDetail,
 * CustomerDetail, WorkAreasTab, and (Phase 5) CatalogDetail. Pattern:
 * - Local `draft` state keeps typing snappy
 * - Parent `value` change re-syncs draft (covers external updates)
 * - onBlur fires onSave only if the value actually changed
 *
 * The shared `inlineInputClasses` default matches the local input styling
 * we'd been duplicating in each consumer; callers can override with the
 * `className` prop when they need different chrome (e.g. ProjectDetail's
 * larger project-name input uses its own styling).
 */

export const inlineInputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

interface BlurSaveInputProps {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  type?: string
  placeholder?: string
  className?: string
  /** When true, the input is non-editable and onBlur save is skipped. */
  disabled?: boolean
}

export function BlurSaveInput({
  value,
  onSave,
  type = 'text',
  placeholder,
  className = inlineInputClasses,
  disabled = false,
}: BlurSaveInputProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (disabled) return
        if (draft !== value) void onSave(draft)
      }}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  )
}

interface BlurSaveTextareaProps {
  value: string
  onSave: (next: string) => Promise<boolean> | void
  rows: number
  placeholder?: string
  className?: string
  /** When true, the textarea is non-editable and onBlur save is skipped. */
  disabled?: boolean
}

export function BlurSaveTextarea({
  value,
  onSave,
  rows,
  placeholder,
  className = inlineInputClasses,
  disabled = false,
}: BlurSaveTextareaProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (disabled) return
        if (draft !== value) void onSave(draft)
      }}
      rows={rows}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  )
}
