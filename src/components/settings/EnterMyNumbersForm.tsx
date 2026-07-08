import {
  CreditCard,
  DollarSign,
  Image as ImageIcon,
  Palette,
  Percent,
  ScrollText,
  Users,
  Wrench,
} from 'lucide-react'
import type {
  CompanyEquipmentRate,
  CompanyLaborType,
  CompanySettings,
} from '@/lib/types'

/**
 * QC-aligned Enter My Numbers cards. Mirrors the QC component structure
 * exactly (src/components/quickcalc/EnterMyNumbers.tsx lines ~286-588):
 *
 *   - PDF Branding (rose gradient + Palette icon)
 *   - Target Billable Rates — Labor (blue header + Users icon)
 *   - Markups grid: Materials (green) + Subcontractors (orange)
 *   - Equipment Rates (purple + Wrench)
 *   - Default Terms & Conditions (slate gradient + ScrollText)
 *
 * CONTROLLED COMPONENT. Parent owns state + save bar.
 *
 * Wizard-mode validity = both markups + at least 1 labor type with
 * both name and rate filled. Equipment + PDF branding + T&C are
 * optional in both modes.
 */

interface EnterMyNumbersFormProps {
  value: Partial<CompanySettings>
  onChange: (patch: Partial<CompanySettings>) => void
  laborTypes: readonly CompanyLaborType[]
  onLaborChange: (slotNumber: number, patch: Partial<CompanyLaborType>) => void
  equipmentRates: readonly CompanyEquipmentRate[]
  onEquipmentChange: (
    slotNumber: number,
    patch: Partial<CompanyEquipmentRate>
  ) => void
  mode: 'wizard' | 'settings'
  onValidityChange?: (isValid: boolean) => void
}

const PRESET_COLORS = [
  '#1e40af', '#0f766e', '#b91c1c', '#7c3aed', '#c2410c',
  '#0369a1', '#15803d', '#4338ca', '#be185d', '#854d0e',
]

export function EnterMyNumbersForm({
  value,
  onChange,
  laborTypes,
  onLaborChange,
  equipmentRates,
  onEquipmentChange,
  mode,
  onValidityChange,
}: EnterMyNumbersFormProps) {
  // Wizard-mode validity (effect lives outside JSX so it doesn't re-run
  // on every render of the giant subtree).
  if (mode === 'wizard' && onValidityChange) {
    const materialsOk =
      typeof value.markup_materials_percent === 'number' &&
      Number.isFinite(value.markup_materials_percent) &&
      value.markup_materials_percent >= 0
    const subsOk =
      typeof value.markup_subs_percent === 'number' &&
      Number.isFinite(value.markup_subs_percent) &&
      value.markup_subs_percent >= 0
    const hasOneLabor = laborTypes.some(
      (lt) =>
        lt.name &&
        lt.name.trim() !== '' &&
        typeof lt.rate_per_hour === 'number' &&
        lt.rate_per_hour >= 0
    )
    onValidityChange(materialsOk && subsOk && hasOneLabor)
  }

  return (
    <div className="space-y-6">
      <PdfBrandingCard value={value} onChange={onChange} />

      <LaborCard laborTypes={laborTypes} onLaborChange={onLaborChange} />

      <MarkupsGrid value={value} onChange={onChange} />

      <EquipmentCard
        equipmentRates={equipmentRates}
        onEquipmentChange={onEquipmentChange}
      />

      <TermsCard value={value} onChange={onChange} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// PDF Branding card
// ──────────────────────────────────────────────────────────────────────

function PdfBrandingCard({
  value,
  onChange,
}: {
  value: Partial<CompanySettings>
  onChange: (patch: Partial<CompanySettings>) => void
}) {
  const color = value.pdf_primary_color || '#1e40af'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-rose-50 to-pink-50 px-6 py-4 border-b border-rose-100 flex items-center gap-3">
        <div className="bg-rose-100 p-2 rounded-lg">
          <Palette className="w-5 h-5 text-rose-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">PDF Branding</h2>
          <p className="text-xs text-gray-500">
            Customize the look of your exported PDF proposals
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Primary Brand Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Primary Brand Color
          </label>
          <p className="text-xs text-gray-400 mb-3">
            Used in PDF headers, totals row, and accent elements
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="color"
              value={color}
              onChange={(e) => onChange({ pdf_primary_color: e.target.value })}
              className="w-12 h-12 rounded-lg border-2 border-gray-200 cursor-pointer p-0.5 bg-white"
              title="Pick a custom color"
            />
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChange({ pdf_primary_color: preset })}
                  className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                    value.pdf_primary_color === preset
                      ? 'border-gray-900 ring-2 ring-offset-1 ring-gray-400'
                      : 'border-gray-200'
                  }`}
                  style={{ backgroundColor: preset }}
                  title={preset}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-400 font-mono">{color}</span>
              <div
                className="w-20 h-6 rounded border border-gray-200"
                style={{ backgroundColor: color }}
              />
            </div>
          </div>
        </div>

        {/* Custom Footer Message */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Custom Footer Message
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Displayed at the bottom of every PDF proposal
          </p>
          <textarea
            placeholder="e.g., Thank you for your business! All proposals valid for 30 days."
            value={value.pdf_footer_text ?? ''}
            onChange={(e) =>
              onChange({
                pdf_footer_text:
                  e.target.value.trim() === '' ? null : e.target.value,
              })
            }
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none resize-y min-h-[56px] transition-all"
          />
        </div>

        {/* Section Visibility Toggles */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            PDF Section Visibility
          </label>
          <p className="text-xs text-gray-400 mb-3">
            Choose which sections appear in your exported PDFs
          </p>
          <div className="space-y-3">
            <ToggleRow
              icon={CreditCard}
              iconColor="text-emerald-500"
              accentBg="peer-checked:bg-emerald-500"
              title="Payment Terms"
              subtitle="Payment milestones and amounts"
              checked={value.pdf_show_payment_terms ?? true}
              onChange={(v) => onChange({ pdf_show_payment_terms: v })}
            />
            <ToggleRow
              icon={ImageIcon}
              iconColor="text-violet-500"
              accentBg="peer-checked:bg-violet-500"
              title="Proposal Images"
              subtitle="Photos attached to the proposal"
              checked={value.pdf_show_images ?? true}
              onChange={(v) => onChange({ pdf_show_images: v })}
            />
            <ToggleRow
              icon={ScrollText}
              iconColor="text-slate-500"
              accentBg="peer-checked:bg-slate-500"
              title="Terms & Conditions"
              subtitle="Legal terms at the bottom of the PDF"
              checked={value.pdf_show_terms_and_conditions ?? true}
              onChange={(v) => onChange({ pdf_show_terms_and_conditions: v })}
            />
          </div>
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Palette className="w-3 h-3" />
          These settings apply to all PDF exports, email shares, and
          "Send to Client" documents.
        </p>
      </div>
    </div>
  )
}

function ToggleRow({
  icon: Icon,
  iconColor,
  accentBg,
  title,
  subtitle,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  accentBg: string
  title: string
  subtitle: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100 cursor-pointer hover:bg-gray-100 transition-all">
      <div className="flex items-center gap-3">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <div>
          <span className="text-sm font-medium text-gray-700">{title}</span>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className={`w-10 h-5 bg-gray-300 ${accentBg} rounded-full transition-colors`} />
        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5" />
      </div>
    </label>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Target Billable Rates — Labor (5 slots)
// ──────────────────────────────────────────────────────────────────────

function LaborCard({
  laborTypes,
  onLaborChange,
}: {
  laborTypes: readonly CompanyLaborType[]
  onLaborChange: (slotNumber: number, patch: Partial<CompanyLaborType>) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-blue-50 px-6 py-4 border-b border-blue-100 flex items-center gap-3">
        <Users className="w-5 h-5 text-blue-600" />
        <div>
          <h2 className="font-semibold text-gray-900">Target Billable Rates — Labor</h2>
          <p className="text-xs text-gray-500">
            Up to 5 labor types with target billable rate per man hour
          </p>
        </div>
      </div>
      <div className="p-6 space-y-3">
        {laborTypes.map((lt) => (
          <div key={lt.id} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-400 w-6 text-right">
              {lt.slot_number}.
            </span>
            <input
              type="text"
              placeholder={`Labor Type ${lt.slot_number}`}
              value={lt.name ?? ''}
              onChange={(e) =>
                onLaborChange(lt.slot_number, {
                  name: e.target.value.trim() === '' ? null : e.target.value,
                })
              }
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={lt.rate_per_hour ?? ''}
                onChange={(e) =>
                  onLaborChange(lt.slot_number, {
                    rate_per_hour:
                      e.target.value === '' ? null : parseFloat(e.target.value) || 0,
                  })
                }
                className="w-32 border border-gray-300 rounded-lg pl-8 pr-3 py-2.5 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <span className="text-xs text-gray-400 w-8">/hr</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Markups (Materials green + Subcontractors orange)
// ──────────────────────────────────────────────────────────────────────

function MarkupsGrid({
  value,
  onChange,
}: {
  value: Partial<CompanySettings>
  onChange: (patch: Partial<CompanySettings>) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MarkupCard
        title="Materials Markup"
        subtitle="Applied to all material items"
        accentBg="bg-green-50"
        accentBorder="border-green-100"
        accentText="text-green-600"
        focusRing="focus:ring-green-500 focus:border-green-500"
        value={value.markup_materials_percent ?? null}
        onChange={(v) => onChange({ markup_materials_percent: v })}
        formulaNoun="Material"
      />
      <MarkupCard
        title="Subcontractors Markup"
        subtitle="Applied to all subcontractor items"
        accentBg="bg-orange-50"
        accentBorder="border-orange-100"
        accentText="text-orange-600"
        focusRing="focus:ring-orange-500 focus:border-orange-500"
        value={value.markup_subs_percent ?? null}
        onChange={(v) => onChange({ markup_subs_percent: v })}
        formulaNoun="Sub"
      />
    </div>
  )
}

function MarkupCard({
  title,
  subtitle,
  accentBg,
  accentBorder,
  accentText,
  focusRing,
  value,
  onChange,
  formulaNoun,
}: {
  title: string
  subtitle: string
  accentBg: string
  accentBorder: string
  accentText: string
  focusRing: string
  value: number | null
  onChange: (v: number | null) => void
  formulaNoun: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className={`${accentBg} px-6 py-4 border-b ${accentBorder} flex items-center gap-3`}>
        <Percent className={`w-5 h-5 ${accentText}`} />
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="p-6">
        <div className="relative">
          <input
            type="number"
            min="0"
            step="0.1"
            value={value ?? ''}
            onChange={(e) =>
              onChange(
                e.target.value === '' ? null : parseFloat(e.target.value) || 0
              )
            }
            className={`w-full border border-gray-300 rounded-lg px-4 py-3 text-lg text-right pr-10 ${focusRing} focus:ring-2 outline-none transition-all`}
          />
          <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {formulaNoun} cost × (1 + {value ?? 0}%) = billed amount
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Billable Equipment Hourly Rates (10 slots)
// ──────────────────────────────────────────────────────────────────────

function EquipmentCard({
  equipmentRates,
  onEquipmentChange,
}: {
  equipmentRates: readonly CompanyEquipmentRate[]
  onEquipmentChange: (
    slotNumber: number,
    patch: Partial<CompanyEquipmentRate>
  ) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-purple-50 px-6 py-4 border-b border-purple-100 flex items-center gap-3">
        <Wrench className="w-5 h-5 text-purple-600" />
        <div>
          <h2 className="font-semibold text-gray-900">Billable Equipment Hourly Rates</h2>
          <p className="text-xs text-gray-500">
            Up to 10 equipment types with hourly rates
          </p>
        </div>
      </div>
      <div className="p-6 space-y-3">
        {equipmentRates.map((eq) => (
          <div key={eq.id} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-400 w-6 text-right">
              {eq.slot_number}.
            </span>
            <input
              type="text"
              placeholder={`Equipment Type ${eq.slot_number}`}
              value={eq.name ?? ''}
              onChange={(e) =>
                onEquipmentChange(eq.slot_number, {
                  name: e.target.value.trim() === '' ? null : e.target.value,
                })
              }
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
            />
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={eq.rate_per_hour ?? ''}
                onChange={(e) =>
                  onEquipmentChange(eq.slot_number, {
                    rate_per_hour:
                      e.target.value === '' ? null : parseFloat(e.target.value) || 0,
                  })
                }
                className="w-32 border border-gray-300 rounded-lg pl-8 pr-3 py-2.5 text-sm text-right focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
              />
            </div>
            <span className="text-xs text-gray-400 w-8">/hr</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Default Terms & Conditions
// ──────────────────────────────────────────────────────────────────────

function TermsCard({
  value,
  onChange,
}: {
  value: Partial<CompanySettings>
  onChange: (patch: Partial<CompanySettings>) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 px-6 py-4 border-b border-gray-200 flex items-center gap-3">
        <div className="bg-slate-100 p-2 rounded-lg">
          <ScrollText className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Default Terms & Conditions</h2>
          <p className="text-xs text-gray-500">
            These terms will automatically appear on every new proposal you create
          </p>
        </div>
      </div>
      <div className="p-6">
        <textarea
          placeholder="Enter your default terms and conditions here... (e.g., Payment due within 30 days. Work guaranteed for 1 year. Changes to scope require written approval. All proposals valid for 30 days.)"
          value={value.default_terms_and_conditions ?? ''}
          onChange={(e) => {
            const next = e.target.value
            const wasEmpty = !(value.default_terms_and_conditions ?? '').trim()
            const nowHasText = next.trim() !== ''
            onChange({
              default_terms_and_conditions: next.trim() === '' ? null : next,
              // This card promises terms "will automatically appear on
              // every new proposal" — but the PDF-visibility toggle lives
              // in a different card, so a contractor can enter terms and
              // never see it. The first time terms are entered, flip the
              // toggle on so the promise holds. (It stays a real control —
              // turn it off later for a bare quote.)
              ...(wasEmpty && nowHasText
                ? { pdf_show_terms_and_conditions: true }
                : {}),
            })
          }}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y min-h-[100px]"
        />
        <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
          <ScrollText className="w-3 h-3" />
          These terms are applied universally to all new proposals. You can
          still edit them per-proposal on the Create Proposal page.
        </p>
      </div>
    </div>
  )
}
