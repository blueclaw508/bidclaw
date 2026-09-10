import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, ScrollText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadCompanySettings } from '@/lib/companySettings'
import { loadEntitlements } from '@/lib/entitlements'
import { getProposal, updateProposal } from '@/lib/proposals'
import { getLatestSignature } from '@/lib/proposalShares'
import { showsGrandTotal } from '@/lib/proposalDefaults'
import { toast } from 'sonner'
import {CrewPlanner} from '@/components/proposals/CrewPlanner'
import {crewTexts, completeCrewTranslation, type CrewLanguage, type CrewTranslations} from '@/lib/crewPlanner'
import {
  PreviewWatermark,
  ProposalDocument,
  type PrintFormat,
} from '@/components/proposals/ProposalDocument'
import type {
  CompanySettings,
  Customer,
  Project,
  ProposalSignature,
  ProposalWithWorkAreas,
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
 * Parallel fetches:
 *   • getProposal(proposalId)            — full proposal + WAs + lines
 *   • loadCompanySettings()              — contractor identity for header
 *   • from('projects').select('*, customer:customers(*)') — project + embedded customer
 *   • getLatestSignature(proposalId)     — the client's decision, for the signature line
 *
 * The document itself lives in components/proposals/ProposalDocument and
 * is shared with the client's approval page (/p/:token). This file is the
 * contractor's container around it: toolbar, format toggle, watermark.
 *
 * Still out of scope: server-side PDF generation (browser print is fine).
 */

interface ProjectWithCustomer extends Project {
  customer: Customer | null
}

const FORMAT_META: Record<PrintFormat, { label: string; blurb: string }> = {
  detailed: { label: 'Detailed', blurb: 'Every line, cost + markup + price' },
  summary: { label: 'Summary', blurb: 'Client proposal — scope + totals' },
  crew: { label: 'Crew', blurb: 'Build sheet — quantities + hours, no pricing' },
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
  const [format, setFormat] = useState<PrintFormat>('detailed')
  const [crewLanguage,setCrewLanguage] = useState<CrewLanguage>('en')
  const [crewTranslation,setCrewTranslation] = useState<{source:string; texts:CrewTranslations} | null>(null)
  const [translating,setTranslating] = useState(false)
  const [translationError,setTranslationError] = useState<string | null>(null)
  // Whether this proposal prints a project total. Seeded from the proposal
  // (or the company default) once loaded; toggling it saves to the proposal
  // so the choice sticks for the next print rather than resetting.
  const [showTotal, setShowTotal] = useState(true)
  const [savingTotal, setSavingTotal] = useState(false)
  // Free trial → every page prints PREVIEW. Defaults false so a failed
  // entitlement read can never watermark a paying customer's proposal.
  const [watermarked, setWatermarked] = useState(false)
  // The client's decision, if they have made one. Fills the customer
  // signature line so the contractor's printed copy is the signed copy.
  const [signature, setSignature] = useState<ProposalSignature | null>(null)

  /* ---------- parallel load ---------- */

  useEffect(() => {
    if (!proposalId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    ;(async () => {
      try {
        const [p, cs, ent, sig] = await Promise.all([
          getProposal(proposalId),
          loadCompanySettings(),
          // Never fail the print because the entitlement read failed —
          // fall back to NOT watermarking. A missing watermark on a paid
          // account's proposal is invisible; a spurious one on a paying
          // customer's document is a support call.
          loadEntitlements().catch(() => null),
          // Same posture: a missing signature prints a blank line, which
          // is what every proposal printed before 0043.
          getLatestSignature(proposalId).catch(() => null),
        ])
        if (cancelled) return
        if (!p) {
          setNotFound(true)
          setLoading(false)
          return
        }
        setSignature(sig)

        // Two independent reasons to stamp PREVIEW:
        //
        //  1. The account is on the free trial — the whole account is
        //     preview-only.
        //  2. This estimate was built by the ONE FREE JAMIE ESTIMATE, and
        //     the account still has no AI of its own. Asked server-side,
        //     because the browser must not be able to talk itself out of it.
        //
        // The second lifts by itself the moment they buy Pro + AI — the
        // function checks their CURRENT plan — so the close is "subscribe
        // and this estimate is yours to send", not "subscribe and redo it".
        const { data: trialMark } = await supabase.rpc(
          'project_needs_ai_trial_watermark',
          { p_project_id: p.project_id }
        )
        if (cancelled) return
        setWatermarked((ent?.watermarked ?? false) || trialMark === true)
        setProposal(p)
        setSettings(cs)
        setShowTotal(showsGrandTotal(p, cs))

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
  const sourceTexts = useMemo(()=>proposal ? crewTexts(proposal,enabledWorkAreas) : {},[proposal,enabledWorkAreas])
  const sourceKey = JSON.stringify({proposalId, texts:sourceTexts})
  const spanishReady = crewTranslation?.source === sourceKey
  const needsSpanish = format === 'crew' && crewLanguage !== 'en'
  const prepareSpanish = async () => {
    if (!proposal || translating) return
    setTranslating(true)
    setTranslationError(null)
    try {
      const {data,error} = await supabase.functions.invoke('crew-translate',{body:{proposalId:proposal.id,texts:sourceTexts}})
      if(error || data?.error) throw new Error(data?.error || 'Could not prepare Spanish. Please retry.')
      if(!completeCrewTranslation(sourceTexts,data?.texts)) throw new Error('Spanish translation is incomplete. Please retry.')
      setCrewTranslation({source:sourceKey,texts:data.texts})
    } catch(err) {setTranslationError(err instanceof Error ? err.message : 'Could not prepare Spanish. Please retry.')}
    finally {setTranslating(false)}
  }

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
      <div className="pv-root min-h-screen bg-gray-100 print:bg-white">
        {watermarked ? <PreviewWatermark /> : null}
        {/* ───── Toolbar — screen only ───── */}
        <div className="pv-toolbar sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
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
              {/* Format toggle (screen-only) — pick what this print renders */}
              <div
                role="tablist"
                aria-label="Output format"
                className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5"
              >
                {(Object.keys(FORMAT_META) as PrintFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={format === f}
                    onClick={() => setFormat(f)}
                    title={FORMAT_META[f].blurb}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                      format === f
                        ? 'bg-brand-navy text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {FORMAT_META[f].label}
                  </button>
                ))}
              </div>
              {/* Total on/off, at print time. An options-priced job has no
                  single true total until the client picks, so this is a
                  per-proposal call, not just a company default. */}
              {format !== 'crew' && <label className="flex shrink-0 items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showTotal}
                  disabled={savingTotal || !proposal}
                  onChange={(e) => {
                    const next = e.target.checked
                    setShowTotal(next)
                    if (!proposal) return
                    setSavingTotal(true)
                    updateProposal(proposal.id, { show_grand_total: next })
                      .catch((err) => {
                        setShowTotal(!next) // put the box back
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Couldn't save that."
                        )
                      })
                      .finally(() => setSavingTotal(false))
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
                />
                Show project total
              </label>}
              {format === 'crew' && <label className="flex items-center gap-2 text-sm">Crew language
                <select aria-label="Crew language" value={crewLanguage} onChange={e=>setCrewLanguage(e.target.value as CrewLanguage)} className="rounded border p-2">
                  <option value="en">English</option><option value="es">Español</option><option value="both">English + Español</option>
                </select>
              </label>}
              {needsSpanish && !spanishReady && <button onClick={()=>void prepareSpanish()} disabled={translating} className="rounded bg-brand-navy px-3 py-2 text-sm text-white disabled:opacity-50">{translating ? 'Preparing Spanish…' : 'Prepare Spanish version'}</button>}
              <span className="hidden text-xs text-gray-500 lg:inline">
                {FORMAT_META[format].blurb} · Save as PDF via the print dialog.
              </span>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!hasContent || (needsSpanish && !spanishReady)}
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

        {/* Discoverability (screen only): Terms & Conditions is a global
            setting under Settings → Enter My Numbers, not a per-proposal
            field. Surface exactly what's wrong: either no terms are
            entered, or they're entered but the PDF toggle is hiding them. */}
        {translationError && format === 'crew' && <p role="alert" className="mx-auto mt-4 max-w-[850px] rounded border border-red-200 bg-red-50 p-3 text-red-800 print:hidden">{translationError}</p>}
        {hasContent && format !== 'crew' &&
          !(
            settings.pdf_show_terms_and_conditions &&
            settings.default_terms_and_conditions?.trim()
          ) && (
            <div className="mx-auto mt-4 flex max-w-[850px] items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 print:hidden">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0" />
              {settings.default_terms_and_conditions?.trim() ? (
                <span>
                  Your Terms &amp; Conditions are entered but{' '}
                  <strong>hidden</strong> from proposal PDFs.{' '}
                  <Link
                    to="/app/settings/enter-my-numbers"
                    className="font-semibold underline hover:text-amber-900"
                  >
                    Turn them on
                  </Link>{' '}
                  (Settings → Enter My Numbers → "PDF Section Visibility") to
                  show them at the bottom of every proposal.
                </span>
              ) : (
                <span>
                  No Terms &amp; Conditions on this proposal.{' '}
                  <Link
                    to="/app/settings/enter-my-numbers"
                    className="font-semibold underline hover:text-amber-900"
                  >
                    Add your default Terms &amp; Conditions
                  </Link>{' '}
                  (Settings → Enter My Numbers, "Default Terms &amp;
                  Conditions") — they'll appear at the bottom of every
                  proposal PDF.
                </span>
              )}
            </div>
          )}

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
          ) : format === 'crew' ? (
            needsSpanish && !spanishReady ? <p role="status">{translating ? 'Preparing the Spanish crew planner…' : 'Prepare the Spanish version to preview and print it.'}</p> :
            <>{(crewLanguage === 'both' ? ['en','es'] as const : [crewLanguage as 'en'|'es']).map((language,index)=><div key={language} style={index ? {breakBefore:'page'} : undefined} className={index ? 'mt-12 print:mt-0' : undefined}>
              <CrewPlanner proposal={proposal} areas={enabledWorkAreas} project={projectWithCustomer} customer={projectWithCustomer.customer} settings={settings} logoUrl={logoUrl} language={language} translations={crewTranslation?.texts}/>
            </div>)}</>
          ) : (
            <ProposalDocument
              settings={settings}
              proposal={proposal}
              project={projectWithCustomer}
              customer={projectWithCustomer.customer}
              enabledWorkAreas={enabledWorkAreas}
              accent={accent}
              logoUrl={logoUrl}
              format={format}
              showTotal={showTotal}
              signature={signature}
            />
          )}
        </div>
      </div>
    </>
  )
}

