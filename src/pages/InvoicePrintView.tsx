import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadCompanySettings } from '@/lib/companySettings'
import { getInvoice } from '@/lib/invoices'
import { InvoiceDocument } from '@/components/invoices/InvoiceDocument'
import type { CompanySettings, Customer, InvoiceWithDetails, Project } from '@/lib/types'

interface ProjectWithCustomer extends Project {
  customer: Customer | null
}

/**
 * The invoice, ready to print or save as PDF. Same shape as the proposal
 * print view: outside the AppShell, a screen-only toolbar, the document.
 */
export default function InvoicePrintView() {
  const { projectId, invoiceId } = useParams<{ projectId: string; invoiceId: string }>()
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [project, setProject] = useState<ProjectWithCustomer | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false
    ;(async () => {
      try {
        const [inv, cs] = await Promise.all([getInvoice(invoiceId), loadCompanySettings()])
        if (cancelled) return
        if (!inv) {
          setState('missing')
          return
        }
        const { data: proj, error: pErr } = await supabase
          .from('projects')
          .select('*, customer:customers(*)')
          .eq('id', inv.project_id)
          .maybeSingle()
        if (pErr) throw new Error(pErr.message)
        if (cancelled) return
        setInvoice(inv)
        setSettings(cs)
        setProject(proj as ProjectWithCustomer)
        if (cs.company_logo_path) {
          try {
            const { data: signed } = await supabase.storage
              .from('company-assets')
              .createSignedUrl(cs.company_logo_path, 3600)
            if (!cancelled && signed?.signedUrl) setLogoUrl(signed.signedUrl)
          } catch {
            /* no logo is fine */
          }
        }
        setState('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Load failed.')
        setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  if (state === 'loading') {
    return <div className="mx-auto max-w-3xl p-8 text-sm text-gray-500">Loading invoice…</div>
  }
  if (state === 'missing') {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-lg font-bold text-rose-900">Invoice not found</h2>
        <Link to={`/app/projects/${projectId}?tab=invoices`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
      </div>
    )
  }
  if (state === 'error' || !invoice || !settings || !project) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load the invoice: {error}
        </div>
      </div>
    )
  }

  const accent = settings.pdf_primary_color || '#1e3a8a'

  return (
    <div className="pv-root min-h-screen bg-gray-100 print:bg-white">
      <div className="pv-toolbar sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-[850px] flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate(`/app/projects/${projectId}/invoices/${invoiceId}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to invoice
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-gray-500 lg:inline">Save as PDF via the print dialog.</span>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="pv-document mx-auto my-6 max-w-[850px] bg-white p-8 shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none sm:p-12">
        <InvoiceDocument
          settings={settings}
          invoice={invoice}
          project={project}
          customer={project.customer}
          accent={accent}
          logoUrl={logoUrl}
        />
      </div>
    </div>
  )
}
