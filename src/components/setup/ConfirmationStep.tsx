import { Building2, ScrollText, Settings as SettingsIcon } from 'lucide-react'
import type {
  CompanyEquipmentRate,
  CompanyLaborType,
  CompanySettings,
} from '@/lib/types'

/**
 * Wizard Step 3 — read-only summary of everything entered in Steps 1
 * and 2. Two-column label/value rows grouped by section per Option A
 * (spec). Edit path is the Back button only — no jump-to-edit links.
 *
 * Data comes from the WizardModal's local state, which is the live
 * source of truth during the wizard (DB only catches up at navigation
 * boundaries via save-on-navigation).
 */
interface ConfirmationStepProps {
  settings: Partial<CompanySettings>
  laborTypes: readonly CompanyLaborType[]
  equipmentRates: readonly CompanyEquipmentRate[]
}

export function ConfirmationStep({
  settings,
  laborTypes,
  equipmentRates,
}: ConfirmationStepProps) {
  // Active labor + equipment rows (rows with name and/or rate filled).
  const filledLabor = laborTypes.filter(
    (lt) =>
      (lt.name && lt.name.trim() !== '') ||
      typeof lt.rate_per_hour === 'number'
  )
  const filledEquipment = equipmentRates.filter(
    (eq) =>
      (eq.name && eq.name.trim() !== '') ||
      typeof eq.rate_per_hour === 'number'
  )

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-800">
        Review what you've entered. Hit <strong>Back</strong> to fix anything,
        or <strong>Complete Setup</strong> to finish. You can edit any of these
        later in Settings.
      </div>

      <SummaryCard
        icon={Building2}
        iconBg="bg-indigo-100"
        iconColor="text-indigo-600"
        title="Company Profile"
      >
        <Row label="Company Name" value={settings.company_legal_name} />
        <Row label="Owner Name" value={settings.owner_name} />
        <Row
          label="Address"
          value={formatAddress(settings)}
        />
        <Row label="Email" value={settings.company_email} />
        <Row label="Phone" value={settings.company_phone} />
        <Row label="Website" value={settings.company_website} />
        <Row
          label="Logo"
          value={settings.company_logo_path ? 'Uploaded' : null}
        />
      </SummaryCard>

      <SummaryCard
        icon={SettingsIcon}
        iconBg="bg-blue-100"
        iconColor="text-blue-600"
        title="Enter My Numbers"
      >
        <Row
          label="PDF Primary Color"
          value={settings.pdf_primary_color}
          mono
        />
        <Row label="PDF Footer" value={settings.pdf_footer_text} />
        <Row
          label="Show Payment Terms"
          value={
            settings.pdf_show_payment_terms === false ? 'No' : 'Yes'
          }
        />
        <Row
          label="Show Images"
          value={settings.pdf_show_images === false ? 'No' : 'Yes'}
        />
        <Row
          label="Show Terms & Conditions"
          value={
            settings.pdf_show_terms_and_conditions === false ? 'No' : 'Yes'
          }
        />

        <SectionDivider label="Target Billable Rates — Labor" />
        {filledLabor.length === 0 ? (
          <Row label="(none)" value={null} muted />
        ) : (
          filledLabor.map((lt) => (
            <Row
              key={lt.id}
              label={lt.name ?? `Labor ${lt.slot_number}`}
              value={
                typeof lt.rate_per_hour === 'number'
                  ? `$${lt.rate_per_hour.toFixed(2)}/hr`
                  : null
              }
            />
          ))
        )}

        <SectionDivider label="Markups" />
        <Row
          label="Materials"
          value={
            typeof settings.markup_materials_percent === 'number'
              ? `${settings.markup_materials_percent}%`
              : null
          }
        />
        <Row
          label="Subcontractors"
          value={
            typeof settings.markup_subs_percent === 'number'
              ? `${settings.markup_subs_percent}%`
              : null
          }
        />

        <SectionDivider label="Equipment Rates" />
        {filledEquipment.length === 0 ? (
          <Row label="(none)" value={null} muted />
        ) : (
          filledEquipment.map((eq) => (
            <Row
              key={eq.id}
              label={eq.name ?? `Equipment ${eq.slot_number}`}
              value={
                typeof eq.rate_per_hour === 'number'
                  ? `$${eq.rate_per_hour.toFixed(2)}/hr`
                  : null
              }
            />
          ))
        )}
      </SummaryCard>

      <SummaryCard
        icon={ScrollText}
        iconBg="bg-slate-100"
        iconColor="text-slate-600"
        title="Default Terms & Conditions"
      >
        <div className="text-sm text-gray-700 whitespace-pre-wrap">
          {settings.default_terms_and_conditions || (
            <span className="text-gray-400 italic">
              No terms entered — proposals will not include a Terms & Conditions
              section by default until you add some.
            </span>
          )}
        </div>
      </SummaryCard>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Building blocks
// ──────────────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-gray-50 to-white px-5 py-3 border-b border-gray-200 flex items-center gap-3">
        <div className={`${iconBg} p-2 rounded-lg`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      <div className="px-5 py-3 space-y-1">{children}</div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  muted,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1 text-sm">
      <div
        className={`text-xs uppercase tracking-wide font-semibold ${
          muted ? 'text-gray-300' : 'text-gray-500'
        }`}
      >
        {label}
      </div>
      <div className={`${mono ? 'font-mono' : ''} text-gray-900`}>
        {value && value.trim() !== '' ? (
          value
        ) : (
          <span className="text-gray-400 italic">—</span>
        )}
      </div>
    </div>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mt-3 mb-1 border-t border-gray-100 pt-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
      {label}
    </div>
  )
}

function formatAddress(s: Partial<CompanySettings>): string | null {
  const parts = [
    s.company_address_line1,
    s.company_address_line2,
    [
      s.company_address_city,
      s.company_address_state,
      s.company_address_zip,
    ]
      .filter(Boolean)
      .join(' '),
  ].filter((part) => part && part.toString().trim() !== '')
  return parts.length === 0 ? null : parts.join(', ')
}
