import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadCompanySettings } from '@/lib/companySettings'
import { getProposal } from '@/lib/proposals'
import { categoryBearsMarkup, formatUSD, lineBase, lineMarkup, lineTotal } from '@/lib/money'
import {
  PROPOSAL_LINE_CATEGORY_LABELS,
  PROPOSAL_LINE_CATEGORY_ORDER,
} from '@/lib/statusConfig'
import type {
  CompanySettings,
  Customer,
  Project,
  ProposalLine,
  ProposalLineCategory,
  ProposalWithWorkAreas,
  ProposalWorkAreaResolved,
} from '@/lib/types'

/**
 * Phase 9-lite — Customer-facing print view.
 *
 * Lives at /app/projects/:projectId/proposals/:proposalId/print.
 *
 * Rendered OUTSIDE the AppShell chrome (see App.tsx route order) so the
 * document fills the page edge-to-edge in screen view and prints clean
 * via the browser's native dialog. The toolbar (screen-only, hidden via
 * @media print) gives a Back link + a Print button that calls
 * window.print().
 *
 * Three parallel fetches:
 *   • getProposal(proposalId)            — full proposal + WAs + lines
 *   • loadCompanySettings()              — contractor identity for header
 *   • from('projects').select('*, customer:customers(*)') — project + embedded customer
 *
 * Render-only: no edit state, no save logic, no dirty tracking.
 *
 * Out of scope for Phase 9-lite (deferred to Phase 9-full):
 *   • Logo upload UI (uses existing company_logo_path if populated;
 *     placeholder otherwise — see CompanyLogo helper at bottom)
 *   • Email-from-app (Resend integration)
 *   • Accept/decline tracking links
 *   • E-sign integration
 *   • Custom per-proposal terms (uses default_terms_and_conditions only)
 *   • Server-side PDF generation (browser print is fine for v1)
 */

interface ProjectWithCustomer extends Project {
  customer: Customer | null
}

export default function ProposalPrintView() {
  const { projectId, proposalId } = useParams<{
    projectId: string
    proposalId: string
  }>()
  const navigate = useNavigate()

  const [proposal, setProposal] = useState<ProposalWithWorkAreas | null>(null)
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [projectWithCustomer, setProjectWithCustomer] =
    useState<ProjectWithCustomer | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  /* ---------- parallel load ---------- */

  useEffect(() => {
    if (!proposalId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    ;(async () => {
      try {
        const [p, cs] = await Promise.all([
          getProposal(proposalId),
          loadCompanySettings(),
        ])
        if (cancelled) return
        if (!p) {
          setNotFound(true)
          setLoading(false)
          return
        }
        setProposal(p)
        setSettings(cs)

        // Project + embedded customer — second fetch after proposal so
        // we can use the proposal.project_id.
        const { data: proj, error: pErr } = await supabase
          .from('projects')
          .select('*, customer:customers(*)')
          .eq('id', p.project_id)
          .maybeSingle()
        if (cancelled) return
        if (pErr) throw new Error(`Couldn't load project: ${pErr.message}`)
        setProjectWithCustomer(proj as ProjectWithCustomer)

        // Logo: if company_logo_path is set, fetch a signed URL from the
        // company-assets bucket. Best-effort — silently skip on failure so
        // the print view still renders without it.
        if (cs.company_logo_path) {
          try {
            const { data: signed } = await supabase.storage
              .from('company-assets')
              .createSignedUrl(cs.company_logo_path, 60 * 60)
            if (!cancelled && signed?.signedUrl) setLogoUrl(signed.signedUrl)
          } catch {
            // ignore — no logo display is acceptable
          }
        }
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Load failed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [proposalId])

  /* ---------- derived ---------- */

  const enabledWorkAreas = useMemo(
    () => (proposal ? proposal.work_areas.filter((wa) => wa.enabled) : []),
    [proposal]
  )
  const hasContent = useMemo(
    () => enabledWorkAreas.some((wa) => wa.lines.length > 0),
    [enabledWorkAreas]
  )

  /* ---------- print ---------- */

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  /* ---------- render guards ---------- */

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-sm text-gray-500">
        Loading print view…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-lg font-bold text-rose-900">Proposal not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This proposal doesn't exist, or belongs to a different account.
        </p>
        <Link
          to={projectId ? `/app/projects/${projectId}?tab=proposals` : '/app/projects'}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load print view: {loadError}
        </div>
      </div>
    )
  }

  if (!proposal || !settings || !projectWithCustomer) return null

  const accent = settings.pdf_primary_color || '#1e3a8a' // brand-navy fallback

  /* ---------- main render ---------- */

  return (
    <>
      {/* Inline @media print + page-break CSS. Lives in the component so
          there's nothing to remember to remove if/when the page is
          deleted. The selectors are namespaced under .pv-* prefixes to
          avoid bleeding into the rest of the app. */}
      <style>{PRINT_CSS}</style>

      <div className="pv-root min-h-screen bg-gray-100 print:bg-white">
        {/* ───── Toolbar — screen only ───── */}
        <div className="pv-toolbar sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="mx-auto flex max-w-[850px] flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/app/projects/${projectId}/proposals/${proposalId}`
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to editor
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <span className="hidden text-xs text-gray-500 sm:inline">
                Use "Save as PDF" in the print dialog destination dropdown to
                export.
              </span>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!hasContent}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  !hasContent
                    ? 'Add at least one enabled work area with lines to print.'
                    : undefined
                }
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        </div>

        {/* ───── Document area — visible on screen AND in print ───── */}
        <div className="pv-document mx-auto my-6 max-w-[850px] bg-white p-8 shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none sm:p-12">
          {!hasContent ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
              <h2 className="text-base font-semibold text-gray-900">
                This proposal has no enabled work areas with lines.
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Add content to print. Empty proposals can't be exported.
              </p>
              <Link
                to={`/app/projects/${projectId}/proposals/${proposalId}`}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to editor
              </Link>
            </div>
          ) : (
            <>
              {/* === Header === */}
              <PrintHeader
                settings={settings}
                proposal={proposal}
                accent={accent}
                logoUrl={logoUrl}
              />

              <hr
                className="pv-accent-rule my-6 h-[2px] border-0"
                style={{ backgroundColor: accent }}
              />

              {/* === Customer + Project === */}
              <CustomerProjectBlock
                project={projectWithCustomer}
                customer={projectWithCustomer.customer}
              />

              {/* === Proposal notes === */}
              {proposal.notes?.trim() ? (
                <section className="pv-section mt-6">
                  <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    Notes
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                    {proposal.notes}
                  </p>
                </section>
              ) : null}

              {/* === Per-work-area sections === */}
              <div className="mt-8 space-y-8">
                {enabledWorkAreas.map((wa) => (
                  <WorkAreaPrintSection
                    key={wa.id}
                    workArea={wa}
                    accent={accent}
                  />
                ))}
              </div>

              {/* === Grand totals === */}
              <div className="pv-totals mt-10">
                <GrandTotalsCard
                  workAreas={enabledWorkAreas}
                  accent={accent}
                />
              </div>

              {/* === Terms & Conditions === */}
              {settings.pdf_show_terms_and_conditions &&
              settings.default_terms_and_conditions?.trim() ? (
                <section className="pv-section pv-page-break-before mt-10">
                  <h3
                    className="pv-section-heading text-sm font-bold uppercase tracking-wider"
                    style={{ color: accent }}
                  >
                    Terms &amp; Conditions
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                    {settings.default_terms_and_conditions}
                  </p>
                </section>
              ) : null}

              {/* === Payment Terms === */}
              {settings.pdf_show_payment_terms ? (
                <section className="pv-section mt-8">
                  <h3
                    className="pv-section-heading text-sm font-bold uppercase tracking-wider"
                    style={{ color: accent }}
                  >
                    Payment Terms
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-gray-700">
                    50% deposit upon acceptance. Balance due upon project
                    completion.
                  </p>
                </section>
              ) : null}

              {/* === Signature block === */}
              <section className="pv-signatures mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2">
                <SignatureLine label="Customer Signature" />
                <SignatureLine label="Contractor Signature" />
              </section>

              {/* === Footer text === */}
              {settings.pdf_footer_text?.trim() ? (
                <footer className="pv-footer mt-10 border-t border-gray-200 pt-4 text-center text-[10px] text-gray-500">
                  {settings.pdf_footer_text}
                </footer>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* ============================================================
 * Header — contractor identity + proposal info
 * ============================================================ */

function PrintHeader({
  settings,
  proposal,
  accent,
  logoUrl,
}: {
  settings: CompanySettings
  proposal: ProposalWithWorkAreas
  accent: string
  logoUrl: string | null
}) {
  const address = formatAddress(settings)
  const contact = [settings.company_phone, settings.company_email, settings.company_website]
    .filter(Boolean)
    .join(' • ')
  const proposalDate = formatDate(proposal.created_at)

  return (
    <header className="pv-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      {/* Left: contractor identity */}
      <div className="flex items-start gap-4">
        <CompanyLogo logoUrl={logoUrl} legalName={settings.company_legal_name} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            {settings.company_legal_name?.trim() || 'Your Company Name'}
          </h1>
          {settings.owner_name?.trim() ? (
            <p className="mt-0.5 text-sm text-gray-600">
              {settings.owner_name}
            </p>
          ) : null}
          {address ? (
            <p className="mt-1 text-xs text-gray-600 leading-snug whitespace-pre-line">
              {address}
            </p>
          ) : null}
          {contact ? (
            <p className="mt-1 text-xs text-gray-600">{contact}</p>
          ) : null}
        </div>
      </div>

      {/* Right: proposal meta */}
      <div className="text-left sm:text-right shrink-0">
        <div
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          Proposal
        </div>
        <h2 className="mt-0.5 text-lg font-bold text-gray-900 leading-tight">
          {proposal.name}
        </h2>
        <p className="mt-1 text-xs text-gray-600">{proposalDate}</p>
        <p className="mt-0.5 text-xs text-gray-600">
          Status: <span className="font-semibold capitalize">{proposal.status}</span>
        </p>
      </div>
    </header>
  )
}

function CompanyLogo({
  logoUrl,
  legalName,
}: {
  logoUrl: string | null
  legalName: string | null
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={legalName || 'Company logo'}
        className="h-[60px] w-[60px] shrink-0 rounded object-contain"
      />
    )
  }
  // Placeholder when logo upload UI ships in Phase 9-full and the
  // contractor hasn't uploaded yet. Shows the company initial.
  const initial = (legalName?.trim()?.[0] || '?').toUpperCase()
  return (
    <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded bg-gray-100 text-2xl font-bold text-gray-400">
      {initial}
    </div>
  )
}

/* ============================================================
 * Customer + project block
 * ============================================================ */

function CustomerProjectBlock({
  project,
  customer,
}: {
  project: Project
  customer: Customer | null
}) {
  const siteAddress =
    project.site_address?.trim() || customer?.site_address?.trim() || '—'
  const customerContact = [customer?.phone, customer?.email]
    .filter(Boolean)
    .join(' • ')

  return (
    <section className="pv-customer-project grid grid-cols-1 gap-6 sm:grid-cols-2">
      <div>
        <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Proposal For
        </h3>
        <p className="mt-1 text-sm font-semibold text-gray-900">
          {customer?.name || '—'}
        </p>
        {customer?.billing_address?.trim() ? (
          <p className="mt-0.5 whitespace-pre-line text-xs text-gray-700">
            {customer.billing_address}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-gray-400">—</p>
        )}
        {customerContact ? (
          <p className="mt-1 text-xs text-gray-700">{customerContact}</p>
        ) : null}
      </div>
      <div>
        <h3 className="pv-section-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Project
        </h3>
        <p className="mt-1 text-sm font-semibold text-gray-900">
          {project.name}
        </p>
        <p className="mt-0.5 whitespace-pre-line text-xs text-gray-700">
          {siteAddress}
        </p>
      </div>
    </section>
  )
}

/* ============================================================
 * Per-work-area section — group by category, line tables
 * ============================================================ */

function WorkAreaPrintSection({
  workArea,
  accent,
}: {
  workArea: ProposalWorkAreaResolved
  accent: string
}) {
  const linesByCategory = useMemo(() => {
    const map: Record<ProposalLineCategory, ProposalLine[]> = {
      labor: [],
      material: [],
      equipment: [],
      subcontractor: [],
      other: [],
    }
    for (const l of workArea.lines) {
      map[l.category].push(l)
    }
    return map
  }, [workArea.lines])

  const visibleCategories = PROPOSAL_LINE_CATEGORY_ORDER.filter(
    (c) => linesByCategory[c].length > 0
  )

  // Work area total = sum of line-level (qty × cost × (1 + markup/100))
  // computed from line-level data (keeps it aligned with the editor's
  // tabular totals card, which reads the same fields).
  const workAreaTotal = useMemo(() => {
    let sum = 0
    for (const l of workArea.lines) {
      sum += lineTotal(l)
    }
    return sum
  }, [workArea.lines])

  return (
    <section className="pv-work-area">
      <h3
        className="pv-section-heading text-base font-bold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {workArea.resolved_name}
      </h3>
      {workArea.resolved_description?.trim() ? (
        <p className="mt-1 whitespace-pre-line text-xs text-gray-600">
          {workArea.resolved_description}
        </p>
      ) : null}

      <div className="mt-3 space-y-4">
        {visibleCategories.map((cat) => (
          <CategoryLineTable
            key={cat}
            category={cat}
            lines={linesByCategory[cat]}
          />
        ))}
      </div>

      {/* Work area total */}
      <div
        className="pv-work-area-total mt-4 flex items-center justify-between border-t-2 px-2 py-2 text-sm"
        style={{ borderColor: accent }}
      >
        <span className="font-bold text-gray-900">
          {workArea.resolved_name} Total
        </span>
        <span className="font-bold tabular-nums" style={{ color: accent }}>
          {formatUSD(workAreaTotal)}
        </span>
      </div>
    </section>
  )
}

function CategoryLineTable({
  category,
  lines,
}: {
  category: ProposalLineCategory
  lines: ProposalLine[]
}) {
  const showMarkup = categoryBearsMarkup(category)

  const sorted = useMemo(
    () => [...lines].sort((a, b) => a.sort_order - b.sort_order),
    [lines]
  )

  const subtotal = sorted.reduce((acc, l) => acc + lineTotal(l), 0)

  return (
    <div className="pv-category-table">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {PROPOSAL_LINE_CATEGORY_LABELS[category]}
      </h4>
      {/* Wrap in overflow-x-auto so mobile scrolls the table horizontally
          within its container instead of overflowing the page. The min-w
          on the table keeps the natural layout on mobile. In print, this
          is a no-op (no overflow at letter width). */}
      <div className="mt-1 overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[480px] border-collapse text-xs print:min-w-0">
        <thead>
          <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="py-1.5 text-left font-semibold">Description</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Unit Cost</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Markup</th>
            <th className="py-1.5 text-right font-semibold">Price</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const qty = Number(l.quantity)
            const cost = Number(l.frozen_unit_cost)
            const markup = Number(l.frozen_markup_percent)
            const price = qty * cost * (1 + markup / 100)
            return (
              <tr key={l.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 text-gray-900">
                  {l.label}
                  {l.unit?.trim() ? (
                    <span className="ml-1 text-gray-400">/ {l.unit}</span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700">
                  {formatQty(qty)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700">
                  {formatUSD(cost)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700">
                  {showMarkup ? `${markup.toFixed(2)}%` : '—'}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">
                  {formatUSD(price)}
                </td>
              </tr>
            )
          })}
          <tr className="bg-gray-50">
            <td colSpan={4} className="py-1.5 pr-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-600">
              {PROPOSAL_LINE_CATEGORY_LABELS[category]} subtotal
            </td>
            <td className="py-1.5 text-right font-bold tabular-nums text-gray-900">
              {formatUSD(subtotal)}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  )
}

/* ============================================================
 * Grand totals card — mirrors Phase 2h tabular layout
 * ============================================================ */

function GrandTotalsCard({
  workAreas,
  accent,
}: {
  workAreas: ProposalWorkAreaResolved[]
  accent: string
}) {
  // Per-category rollup across all enabled work areas. Material /
  // subcontractor / other carry markup; labor + equipment do not
  // (markup column shows "—" + base = total).
  const rollup: Record<ProposalLineCategory, { base: number; markup: number; count: number }> =
    useMemo(() => {
      const r: Record<ProposalLineCategory, { base: number; markup: number; count: number }> = {
        labor: { base: 0, markup: 0, count: 0 },
        material: { base: 0, markup: 0, count: 0 },
        equipment: { base: 0, markup: 0, count: 0 },
        subcontractor: { base: 0, markup: 0, count: 0 },
        other: { base: 0, markup: 0, count: 0 },
      }
      for (const wa of workAreas) {
        for (const l of wa.lines) {
          r[l.category].base += lineBase(l)
          r[l.category].markup += lineMarkup(l)
          r[l.category].count += 1
        }
      }
      return r
    }, [workAreas])

  // Visibility by LINE COUNT, not dollars (P1-D cleanup 1 falsy-zero
  // fix): a category whose lines are all $0 (unpriced yet) must still
  // show on the customer document rather than silently vanishing.
  const visibleCategories = PROPOSAL_LINE_CATEGORY_ORDER.filter(
    (c) => rollup[c].count > 0
  )

  const grandTotal = visibleCategories.reduce(
    (acc, c) => acc + rollup[c].base + rollup[c].markup,
    0
  )

  return (
    <div className="pv-totals-card overflow-hidden rounded-lg border border-gray-200">
      <header
        className="pv-totals-header border-b px-4 py-2"
        style={{ borderColor: accent, backgroundColor: hexA(accent, 0.06) }}
      >
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          Proposal Total
        </h3>
      </header>

      <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[480px] text-sm print:min-w-0">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="px-4 py-2 text-left font-semibold">Category</th>
            <th className="px-4 py-2 text-right font-semibold">Base</th>
            <th className="px-4 py-2 text-right font-semibold">Markup</th>
            <th className="px-4 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visibleCategories.map((cat) => {
            const { base, markup } = rollup[cat]
            const showMarkup = categoryBearsMarkup(cat)
            return (
              <tr key={cat}>
                <td className="px-4 py-2 text-gray-700">{PROPOSAL_LINE_CATEGORY_LABELS[cat]}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatUSD(base)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                  {showMarkup && markup > 0 ? `+ ${formatUSD(markup)}` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {formatUSD(base + markup)}
                </td>
              </tr>
            )
          })}
          <tr style={{ backgroundColor: hexA(accent, 0.08) }}>
            <td
              colSpan={3}
              className="px-4 py-3 text-base font-bold"
              style={{ color: accent }}
            >
              GRAND TOTAL
            </td>
            <td
              className="px-4 py-3 text-right text-lg font-bold tabular-nums"
              style={{ color: accent }}
            >
              {formatUSD(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  )
}

/* ============================================================
 * Signature line
 * ============================================================ */

function SignatureLine({ label }: { label: string }) {
  return (
    <div className="pv-signature">
      <div className="mt-8 border-b border-gray-400 pb-1" />
      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500">
        <span>{label}</span>
        <span>Date</span>
      </div>
    </div>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

function formatAddress(s: CompanySettings): string {
  const line1 = s.company_address_line1?.trim()
  const line2 = s.company_address_line2?.trim()
  const cityStateZip = [
    s.company_address_city?.trim(),
    s.company_address_state?.trim(),
    s.company_address_zip?.trim(),
  ]
    .filter(Boolean)
    .join(s.company_address_state?.trim() ? ', ' : ' ')
    .replace(/, ([A-Z]{2})/, ', $1') // city, ST zip
  // Re-join the state + zip without extra commas:
  const parts: string[] = []
  if (line1) parts.push(line1)
  if (line2) parts.push(line2)
  // city/state/zip line — handle each piece cleanly
  const csz = [
    s.company_address_city?.trim(),
    [s.company_address_state?.trim(), s.company_address_zip?.trim()]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  if (csz) parts.push(csz)
  // (The earlier `cityStateZip` value is shadowed — kept as a guardrail
  // example of why this helper deserves its own tested utility one day.)
  void cityStateZip
  return parts.join('\n')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}


/** Hex color + alpha → rgba() string. Accepts #RRGGBB; defaults to navy. */
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(30, 58, 138, ${a})`
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/* ============================================================
 * Print CSS — @page + @media print rules
 *
 * Goals:
 *   • Hide the toolbar in print (it's screen-only)
 *   • Letter paper, 0.5" margins, fixed font sizes for the document
 *   • Avoid splitting tables / WA sections mid-page when possible
 *   • Strip background colors except the accent-tinted bits we
 *     explicitly want (totals header + grand-total row)
 *   • Page numbers via @page bottom-center marker
 * ============================================================ */

const PRINT_CSS = `
@media print {
  @page {
    size: Letter;
    margin: 0.5in;
  }

  html, body {
    background: white !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .pv-root {
    background: white !important;
  }

  /* Hide the toolbar */
  .pv-toolbar {
    display: none !important;
  }

  /* Document area: full-bleed in print */
  .pv-document {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    background: white !important;
  }

  /* Keep a single work area section on one page when it fits */
  .pv-work-area {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* Keep each category's line table together too */
  .pv-category-table {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* Totals + signatures stay together at the end */
  .pv-totals-card,
  .pv-signatures {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* Slightly tighter typography for print */
  .pv-document {
    font-size: 11pt;
  }

  /* Strip default link styling so URLs print as plain text where used */
  .pv-document a {
    color: inherit !important;
    text-decoration: none !important;
  }
}
`
