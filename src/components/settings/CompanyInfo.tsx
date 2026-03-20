import { ExternalLink, Building2, User, MapPin, Phone, Mail, Image } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { PageLayout, CardSection } from '@/components/PageLayout'

export default function CompanyInfo() {
  const { companyProfile } = useAuth()

  if (!companyProfile) {
    return (
      <PageLayout
        icon={<Building2 size={24} />}
        title="Company Info"
        subtitle="Your company profile from BlueQuickCalc"
      >
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Building2 className="mx-auto mb-4 text-slate-300" size={48} />
          <h3 className="text-lg font-semibold text-slate-700">
            No Company Profile Found
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Set up your company profile in BlueQuickCalc to see it here.
          </p>
          <a
            href="https://bluequickcalc.app/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#1e40af] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e3a8a] transition-colors"
          >
            Go to BlueQuickCalc Settings
            <ExternalLink size={14} />
          </a>
        </div>
      </PageLayout>
    )
  }

  const fields: { label: string; value: string | undefined; icon: React.ReactNode }[] = [
    { label: 'Company Name', value: companyProfile.companyName, icon: <Building2 size={16} /> },
    { label: 'Owner Name', value: companyProfile.userName, icon: <User size={16} /> },
    { label: 'Address', value: companyProfile.companyAddress, icon: <MapPin size={16} /> },
    { label: 'Phone', value: companyProfile.companyPhone, icon: <Phone size={16} /> },
    { label: 'Email', value: companyProfile.companyEmail, icon: <Mail size={16} /> },
  ]

  return (
    <PageLayout
      icon={<Building2 size={24} />}
      title="Company Info"
      subtitle="Your company profile from BlueQuickCalc"
    >
      <div className="space-y-5">
        {/* Info Banner */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-800">
            This information is pulled from your BlueQuickCalc account. To update, visit{' '}
            <a
              href="https://bluequickcalc.app/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#1e40af] underline underline-offset-2 hover:text-[#1e3a8a]"
            >
              Settings in BlueQuickCalc
              <ExternalLink size={12} />
            </a>
            .
          </p>
        </div>

        <CardSection icon={<Image size={18} />} title="Company Logo" subtitle="Displayed on your estimates">
          {companyProfile.companyLogoBase64 ? (
            <img
              src={companyProfile.companyLogoBase64}
              alt={`${companyProfile.companyName} logo`}
              className="h-20 w-auto rounded-md border border-slate-200 bg-slate-50 object-contain p-2"
            />
          ) : (
            <div className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50">
              <Image size={24} className="text-slate-300" />
            </div>
          )}
        </CardSection>

        <CardSection icon={<Building2 size={18} />} title="Company Profile" subtitle="Business details from QuickCalc">
          <div className="divide-y divide-slate-100">
            {fields.map((field) => (
              <div key={field.label} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <span className="text-slate-400">{field.icon}</span>
                <div className="flex-1">
                  <label className="mb-0.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    {field.label}
                  </label>
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {field.value || <span className="italic text-slate-400">Not set</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardSection>

        {/* Website (if available) */}
        {companyProfile.companyWebsite && (
          <CardSection icon={<ExternalLink size={18} />} title="Website">
            <a
              href={
                companyProfile.companyWebsite.startsWith('http')
                  ? companyProfile.companyWebsite
                  : `https://${companyProfile.companyWebsite}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[#1e40af] hover:underline"
            >
              {companyProfile.companyWebsite}
              <ExternalLink size={12} />
            </a>
          </CardSection>
        )}
      </div>
    </PageLayout>
  )
}
