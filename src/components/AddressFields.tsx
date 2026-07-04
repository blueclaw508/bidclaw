import type { SplitAddress } from '@/lib/address'

/**
 * QC-style split address field group (R5): Line1 full-width, then
 * City / State / Zip on one row. Controlled — the parent owns the four
 * values. `onFieldBlur` (optional) fires per field for blur-save
 * surfaces (detail pages); modal forms just read state at submit.
 */

type FieldKey = keyof SplitAddress

interface AddressFieldsProps {
  value: SplitAddress
  onChange: (field: FieldKey, value: string) => void
  onFieldBlur?: (field: FieldKey, value: string) => void
  disabled?: boolean
  /** id prefix so labels stay unique when two groups render (billing + site). */
  idPrefix: string
}

export function AddressFields({
  value,
  onChange,
  onFieldBlur,
  disabled = false,
  idPrefix,
}: AddressFieldsProps) {
  const field = (key: FieldKey, placeholder: string, className: string) => (
    <input
      id={`${idPrefix}-${key}`}
      type="text"
      value={value[key] ?? ''}
      onChange={(e) => onChange(key, e.target.value)}
      onBlur={(e) => onFieldBlur?.(key, e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={placeholder}
      className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-gray-50 disabled:text-gray-500 ${className}`}
    />
  )

  return (
    <div className="space-y-2">
      {field('line1', 'Street address', 'w-full')}
      <div className="grid grid-cols-[1fr_72px_96px] gap-2">
        {field('city', 'City', 'w-full')}
        {field('state', 'State', 'w-full')}
        {field('zip', 'Zip', 'w-full')}
      </div>
    </div>
  )
}
