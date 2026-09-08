import { CompanyLogo, PrintStyles } from '@/components/proposals/ProposalDocument'
import { formatUSD } from '@/lib/money'
import { formatInvoiceNumber, invoiceBalance } from '@/lib/invoices'
import { formatDateOnly, PAYMENT_METHOD_LABELS } from '@/lib/invoiceStatus'
import { resolveAddress } from '@/lib/address'
import type { CompanySettings, Customer, InvoiceWithDetails, Project } from '@/lib/types'

/**
 * The invoice as the client receives it. Same page furniture as the
 * proposal (.pv-* layout and print CSS) so the two documents read as one
 * company's paperwork: logo and identity top-left, the document's own
 * facts top-right, bill-to and job, lines, totals, notes, terms.
 */
export function InvoiceDocument({
  settings,
  invoice,
  project,
  customer,
  accent,
  logoUrl,
}: {
  settings: Pick<
    CompanySettings,
    | 'company_legal_name'
    | 'owner_name'
    | 'company_address_line1'
    | 'company_address_line2'
    | 'company_address_city'
    | 'company_address_state'
    | 'company_address_zip'
    | 'company_phone'
    | 'company_email'
    | 'company_website'
    | 'invoice_prefix'
    | 'invoice_footer_text'
    | 'pdf_footer_text'
  >
  invoice: InvoiceWithDetails
  project: Project
  customer: Customer | null
  accent: string
  logoUrl: string | null
}) {
  const number = formatInvoiceNumber(settings.invoice_prefix, invoice.invoice_number)
  const balance = invoiceBalance(invoice)
  const contact = [settings.company_phone, settings.company_email, settings.company_website]
    .filter(Boolean)
    .join(' • ')
  const companyAddress = [
    settings.company_address_line1?.trim(),
    settings.company_address_line2?.trim(),
    [
      settings.company_address_city?.trim(),
      [settings.company_address_state?.trim(), settings.company_address_zip?.trim()].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean)

  const billingAddress = customer
    ? resolveAddress(
        {
          line1: customer.billing_address_line1,
          city: customer.billing_address_city,
          state: customer.billing_address_state,
          zip: customer.billing_address_zip,
        },
        customer.billing_address
      )
    : ''
  const siteAddress =
    resolveAddress(
      {
        line1: project.site_address_line1,
        city: project.site_address_city,
        state: project.site_address_state,
        zip: project.site_address_zip,
      },
      project.site_address
    ) || ''

  const footer = settings.invoice_footer_text?.trim() || settings.pdf_footer_text?.trim() || ''

  return (
    <>
      <PrintStyles />

      {/* === Header === */}
      <header className="pv-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <CompanyLogo logoUrl={logoUrl} legalName={settings.company_legal_name} />
          <div>
            <p className="text-lg font-bold leading-tight text-gray-900">
              {settings.company_legal_name || 'Company name'}
            </p>
            {settings.owner_name ? <p className="text-xs text-gray-600">{settings.owner_name}</p> : null}
            {companyAddress.map((line, i) => (
              <p key={i} className="text-xs text-gray-600">
                {line}
              </p>
            ))}
            {contact ? <p className="mt-1 text-xs text-gray-600">{contact}</p> : null}
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl font-black tracking-tight" style={{ color: accent }}>
            INVOICE
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{number}</p>
          <table className="mt-2 text-xs text-gray-600 sm:ml-auto">
            <tbody>
              <tr>
                <td className="pr-3 text-gray-500">Date</td>
                <td className="text-gray-900">{formatDateOnly(invoice.issue_date)}</td>
              </tr>
              {invoice.due_date ? (
                <tr>
                  <td className="pr-3 text-gray-500">Due</td>
                  <td className="text-gray-900">{formatDateOnly(invoice.due_date)}</td>
                </tr>
              ) : null}
              {invoice.status === 'paid' ? (
                <tr>
                  <td className="pr-3 text-gray-500">Status</td>
                  <td className="font-semibold text-emerald-700">PAID</td>
                </tr>
              ) : invoice.status === 'void' ? (
                <tr>
                  <td className="pr-3 text-gray-500">Status</td>
                  <td className="font-semibold text-gray-500">VOID</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </header>

      <hr className="pv-accent-rule my-6 h-[2px] border-0" style={{ backgroundColor: accent }} />

      {/* === Bill to / Job === */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Bill to
          </h3>
          <p className="mt-1 text-sm font-semibold text-gray-900">{customer?.name ?? '—'}</p>
          {billingAddress ? (
            <p className="whitespace-pre-line text-xs text-gray-600">{billingAddress}</p>
          ) : null}
          {customer?.email ? <p className="text-xs text-gray-600">{customer.email}</p> : null}
          {customer?.phone ? <p className="text-xs text-gray-600">{customer.phone}</p> : null}
        </div>
        <div>
          <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Project
          </h3>
          <p className="mt-1 text-sm font-semibold text-gray-900">{project.name}</p>
          {siteAddress ? <p className="whitespace-pre-line text-xs text-gray-600">{siteAddress}</p> : null}
          {invoice.milestone_label ? (
            <p className="mt-1 text-xs text-gray-600">
              {invoice.milestone_label}
              {invoice.milestone_percent !== null ? ` · ${invoice.milestone_percent}% of contract` : ''}
            </p>
          ) : null}
        </div>
      </section>

      {/* === Lines === */}
      <section className="pv-section mt-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500">
              <th className="pb-2 text-left font-bold">Description</th>
              <th className="pb-2 text-right font-bold">Qty</th>
              <th className="pb-2 text-right font-bold">Rate</th>
              <th className="pb-2 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-t border-gray-200">
                <td className="py-2 pr-3 text-gray-900">{l.description}</td>
                <td className="py-2 text-right tabular-nums text-gray-700">
                  {Number.isInteger(l.quantity) ? l.quantity : l.quantity.toFixed(2)}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-700">{formatUSD(l.unit_price)}</td>
                <td className="py-2 text-right tabular-nums font-semibold text-gray-900">
                  {formatUSD(l.amount)}
                </td>
              </tr>
            ))}
            {invoice.lines.length === 0 ? (
              <tr className="border-t border-gray-200">
                <td colSpan={4} className="py-3 text-sm italic text-gray-400">
                  No lines yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="pv-totals mt-4 flex justify-end">
          <table className="text-sm">
            <tbody>
              <tr>
                <td className="pr-6 py-1 text-gray-600">Subtotal</td>
                <td className="py-1 text-right tabular-nums text-gray-900">{formatUSD(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td className="pr-6 py-1 font-semibold text-gray-900">Total</td>
                <td className="py-1 text-right tabular-nums font-semibold text-gray-900">
                  {formatUSD(invoice.total)}
                </td>
              </tr>
              {invoice.amount_paid > 0 ? (
                <tr>
                  <td className="pr-6 py-1 text-gray-600">Paid</td>
                  <td className="py-1 text-right tabular-nums text-gray-900">
                    − {formatUSD(invoice.amount_paid)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td className="pr-6 py-2 text-base font-bold" style={{ color: accent }}>
                  Balance due
                </td>
                <td className="py-2 text-right text-base font-bold tabular-nums" style={{ color: accent }}>
                  {formatUSD(invoice.status === 'void' ? 0 : balance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {invoice.payments.length > 0 ? (
        <section className="pv-section mt-6">
          <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Payments received
          </h3>
          <ul className="mt-1 text-xs text-gray-700">
            {invoice.payments.map((p) => (
              <li key={p.id}>
                {formatDateOnly(p.paid_on)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                {p.reference ? ` · ${p.reference}` : ''} · {formatUSD(p.amount)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.notes?.trim() ? (
        <section className="pv-section mt-6">
          <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Notes
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{invoice.notes}</p>
        </section>
      ) : null}

      {invoice.terms?.trim() ? (
        <section className="pv-section mt-6">
          <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Payment terms
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{invoice.terms}</p>
        </section>
      ) : null}

      {footer ? (
        <footer className="pv-footer mt-10 border-t border-gray-200 pt-4 text-center text-[10px] text-gray-500">
          {footer}
        </footer>
      ) : null}
    </>
  )
}
