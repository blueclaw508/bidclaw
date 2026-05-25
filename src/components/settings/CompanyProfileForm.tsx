import { useEffect, useRef, useState } from 'react'
import { Building2, ImagePlus, Mail, MapPin, Phone, Globe, User, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  LOGO_ACCEPT,
  LOGO_SIZE_CAP,
  getCompanyLogoUrl,
  uploadCompanyLogo,
} from '@/lib/companySettings'
import type { CompanySettings } from '@/lib/types'

/**
 * QC-aligned Company Profile card. Mirrors QC's component structure
 * exactly (src/components/quickcalc/EnterMyNumbers.tsx lines ~150-284):
 *
 *   - Indigo gradient header pill (Building2 icon + title + helper)
 *   - Logo upload (24×24 dashed-border drop, hover-X remove, "Change Logo" link)
 *   - Right column: Company Name + Owner Name (icon-prefix inputs)
 *   - Address row (icon-prefix) — UNLIKE QC, BidClaw splits into 5 fields
 *     under one Address group for QBO compatibility (Line 1 / Line 2 /
 *     City / State / ZIP). Country defaults to US, not stored.
 *   - Email / Phone (2-col grid)
 *   - Website
 *   - Helper text at bottom
 *
 * CONTROLLED COMPONENT. Parent owns state + save behavior. Logo upload
 * is the one exception — it writes to storage immediately (returns a
 * path); the parent merges the path into local state via onChange.
 */

interface CompanyProfileFormProps {
  value: Partial<CompanySettings>
  onChange: (patch: Partial<CompanySettings>) => void
  mode: 'wizard' | 'settings'
  onValidityChange?: (isValid: boolean) => void
}

const ACCEPT_ATTR = Object.values(LOGO_ACCEPT).flat().join(',')

const US_STATES: readonly { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },        { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },        { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },     { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },    { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },        { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },         { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },       { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },           { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },       { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },          { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },      { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },       { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },       { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },     { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },           { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },         { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },   { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },   { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },          { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },        { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },     { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },      { code: 'WY', name: 'Wyoming' },
]

export function CompanyProfileForm({
  value,
  onChange,
  mode,
  onValidityChange,
}: CompanyProfileFormProps) {
  // Wizard validity: Company Name + Owner Name + (Address Line 1 + City
  // + State + ZIP) + Email + Phone. Address Line 2 + Website optional.
  useEffect(() => {
    if (!onValidityChange) return
    if (mode !== 'wizard') {
      onValidityChange(true)
      return
    }
    const isFilled = (s: string | null | undefined) =>
      typeof s === 'string' && s.trim() !== ''
    const valid =
      isFilled(value.company_legal_name) &&
      isFilled(value.owner_name) &&
      isFilled(value.company_address_line1) &&
      isFilled(value.company_address_city) &&
      isFilled(value.company_address_state) &&
      isFilled(value.company_address_zip) &&
      isFilled(value.company_email) &&
      isFilled(value.company_phone)
    onValidityChange(valid)
  }, [
    mode,
    onValidityChange,
    value.company_legal_name,
    value.owner_name,
    value.company_address_line1,
    value.company_address_city,
    value.company_address_state,
    value.company_address_zip,
    value.company_email,
    value.company_phone,
  ])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* QC's Company Profile header — indigo gradient + Building2 icon pill */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-indigo-100 flex items-center gap-3">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <Building2 className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Company Profile</h2>
          <p className="text-xs text-gray-500">
            This information appears at the top of your PDF proposals
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Logo + Company Name + Owner Name row */}
        <div className="flex items-start gap-4">
          <LogoUploader
            path={value.company_logo_path ?? null}
            onPathChange={(p) => onChange({ company_logo_path: p })}
          />
          <div className="flex-1 space-y-3">
            <IconInput
              icon={Building2}
              type="text"
              placeholder="Company Name"
              required={mode === 'wizard'}
              value={value.company_legal_name ?? ''}
              onChange={(v) => onChange({ company_legal_name: cleanedOrNull(v) })}
              boldFont
            />
            <IconInput
              icon={User}
              type="text"
              placeholder="Your Name"
              required={mode === 'wizard'}
              value={value.owner_name ?? ''}
              onChange={(v) => onChange({ owner_name: cleanedOrNull(v) })}
            />
          </div>
        </div>

        {/* Address — split into 5 fields for QBO compatibility. Visual
            treatment matches QC's single-field styling but expanded. */}
        <div className="space-y-3">
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Address Line 1"
            required={mode === 'wizard'}
            value={value.company_address_line1 ?? ''}
            onChange={(v) => onChange({ company_address_line1: cleanedOrNull(v) })}
          />
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Address Line 2 (optional)"
            value={value.company_address_line2 ?? ''}
            onChange={(v) => onChange({ company_address_line2: cleanedOrNull(v) })}
          />
          {/* 3-col grid: City (flex) | State (200px for full names like
              "District of Columbia") | ZIP (120px). Tailwind arbitrary
              values use UNDERSCORES (which compile to CSS spaces);
              commas produce invalid CSS and silently degrade to a
              1-col stack. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px_120px] gap-3">
            <input
              type="text"
              placeholder="City"
              required={mode === 'wizard'}
              value={value.company_address_city ?? ''}
              onChange={(e) => onChange({ company_address_city: cleanedOrNull(e.target.value) })}
              className={inputClasses}
            />
            <select
              required={mode === 'wizard'}
              value={value.company_address_state ?? ''}
              onChange={(e) =>
                onChange({ company_address_state: e.target.value === '' ? null : e.target.value })
              }
              className={inputClasses}
            >
              <option value="">State</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="ZIP"
              required={mode === 'wizard'}
              value={value.company_address_zip ?? ''}
              onChange={(e) => onChange({ company_address_zip: cleanedOrNull(e.target.value) })}
              maxLength={10}
              className={inputClasses}
            />
          </div>
        </div>

        {/* Email + Phone row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={Mail}
            type="email"
            placeholder="Company Email"
            required={mode === 'wizard'}
            value={value.company_email ?? ''}
            onChange={(v) => onChange({ company_email: cleanedOrNull(v) })}
          />
          <IconInput
            icon={Phone}
            type="tel"
            placeholder="Company Phone Number"
            required={mode === 'wizard'}
            value={value.company_phone ?? ''}
            onChange={(v) => onChange({ company_phone: cleanedOrNull(v) })}
          />
        </div>

        <IconInput
          icon={Globe}
          type="url"
          placeholder="Company Website (e.g., www.yourcompany.com)"
          value={value.company_website ?? ''}
          onChange={(v) => onChange({ company_website: cleanedOrNull(v) })}
        />

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          This info appears at the top of your PDF proposals. Logo must be under 500KB.
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Icon-prefix input — matches QC's "relative wrapper + absolute icon"
// pattern exactly. Reused for every contact field.
// ──────────────────────────────────────────────────────────────────────

interface IconInputProps {
  icon: React.ComponentType<{ className?: string }>
  type: 'text' | 'email' | 'tel' | 'url'
  placeholder: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  boldFont?: boolean
}

function IconInput({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  required,
  boldFont,
}: IconInputProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type={type}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2.5 text-sm ${
          boldFont ? 'font-medium' : ''
        } focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all`}
      />
    </div>
  )
}

const inputClasses =
  'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all'

function cleanedOrNull(raw: string): string | null {
  return raw.trim() === '' ? null : raw
}

// ──────────────────────────────────────────────────────────────────────
// Logo uploader — 24×24 box, dashed border when empty, hover-X remove
// when populated, "Change Logo" link below. Matches QC visual + flow.
//
// Storage write happens IMMEDIATELY on file pick (writes to
// company-assets bucket and returns the path). The path is fed back to
// the parent via onPathChange — the parent merges it into local state
// and persists on Save (or per-step in wizard mode).
// ──────────────────────────────────────────────────────────────────────

function LogoUploader({
  path,
  onPathChange,
}: {
  path: string | null
  onPathChange: (newPath: string | null) => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!path) {
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    void getCompanyLogoUrl(path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(`Couldn't load logo preview: ${(err as Error).message}`)
        }
      })
    return () => {
      cancelled = true
    }
  }, [path])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPG, GIF, WebP).')
      return
    }
    if (file.size > LOGO_SIZE_CAP) {
      toast.error('Logo file must be under 500KB. Please use a smaller image.')
      return
    }
    setUploading(true)
    try {
      const newPath = await uploadCompanyLogo(file)
      onPathChange(newPath)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="shrink-0">
      {previewUrl ? (
        <div className="relative group">
          <img
            src={previewUrl}
            alt="Company Logo"
            className="w-24 h-24 object-contain rounded-lg border border-gray-200 bg-gray-50 p-1"
          />
          <button
            type="button"
            onClick={() => onPathChange(null)}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
            title="Remove logo"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-all bg-gray-50 disabled:opacity-50"
        >
          <ImagePlus className="w-6 h-6" />
          <span className="text-[10px] font-medium">
            {uploading ? 'Uploading…' : 'Upload Logo'}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleFile}
        className="hidden"
      />
      {previewUrl && !uploading && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 text-[10px] text-indigo-600 hover:text-indigo-700 font-medium w-24 text-center"
        >
          Change Logo
        </button>
      )}
    </div>
  )
}
