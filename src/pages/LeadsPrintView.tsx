import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadCompanySettings } from '@/lib/companySettings'
import { leadTitle, listLeads } from '@/lib/leads'
import { POOL_CARD_CLASSES, POOL_LEGEND, POOL_ROW_CLASSES, isPoolWork } from '@/lib/poolWork'
import {
  LEAD_REGION_CONFIG,
  LEAD_REGION_ORDER,
  LEAD_STAGE_CONFIG,
  LEAD_STAGE_ORDER,
} from '@/lib/statusConfig'
import type { CompanySettings, LeadListRow, LeadStage } from '@/lib/types'

/**
 * Leads & Bids — printable pipeline report (11x17 tabloid).
 *
 * Lives at /app/leads/print. Rendered OUTSIDE the AppShell chrome (see
 * App.tsx route order) so the sheet fills the page edge-to-edge on
 * screen and prints clean through the browser dialog — same pattern as
 * ProposalPrintView.
 *
 * Why 11x17: the pipeline is 8 stages wide and the dashboard row has 10
 * meaningful columns. On Letter you either lose columns or shrink the
 * type past readable. Tabloid landscape (17in x 11in) fits the whole
 * board across, and the detail table at 8pt with room to spare — which
 * is what Ian actually tapes to the wall / walks into a meeting with.
 *
 * Every control is screen-only (.lpv-toolbar is display:none in print).
 *
 * Three formats:
 *   board   — the pipeline snapshot: one column per stage, cards inside
 *   detail  — every lead as a row, grouped by stage (or location),
 *             with per-group subtotals and a grand total
 *   summary — one-sheet rollup: stage x location matrix, no rows
 *
 * Filters arrive as query params from the Leads page so the printout
 * matches whatever was on screen. Nothing is re-derived here — the same
 * predicate list as Leads.tsx, kept deliberately simple.
 */

type Paper = 'tabloid-landscape' | 'tabloid-portrait' | 'letter-landscape'
type Format = 'board' | 'detail' | 'summary'
type DateField = 'none' | 'created' | 'follow_up' | 'presented'

const PAPER_META: Record<Paper, { label: string; blurb: string; css: string; width: number }> = {
  'tabloid-landscape': {
    label: '11×17 Landscape',
    blurb: 'Tabloid, wide — the full board across one sheet',
    css: '17in 11in',
    width: 1560,
  },
  'tabloid-portrait': {
    label: '11×17 Portrait',
    blurb: 'Tabloid, tall — more rows per sheet',
    css: '11in 17in',
    width: 1000,
  },
  'letter-landscape': {
    label: 'Letter',
    blurb: 'Letter landscape — fallback for an 8.5×11 printer',
    css: '11in 8.5in',
    width: 1000,
  },
}

const FORMAT_META: Record<Format, { label: string; blurb: string }> = {
  board: { label: 'Board', blurb: 'Pipeline snapshot — one column per stage' },
  detail: { label: 'Meeting sheet', blurb: 'Jobs listed by stage and location, like the Leads Bids workbook' },
  summary: { label: 'Summary', blurb: 'One sheet — stage × location rollup' },
}

const REPORT_FIELDS = ['Project Name','Address','Description','Created','Location','Source','Contact','Phone / Email','Follow-up','Proposals','Proposal sent','Stage','Value'] as const
type ReportField = typeof REPORT_FIELDS[number]
const DEFAULT_FIELDS: ReportField[] = ['Project Name','Address','Description','Created','Location','Source','Value']
function readSelection<T extends string>(key: string, valid: readonly T[], fallback: T[]): T[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(saved)) { const selected = valid.filter(v => saved.includes(v)); if (selected.length) return [...selected] } } catch { /* unavailable storage */ }
  return fallback
}

export default function LeadsPrintView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [rows, setRows] = useState<LeadListRow[] | null>(null)
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Print options — seeded from the Leads page so the sheet matches what
  // was on screen, then freely changeable here.
  const [paper, setPaper] = useState<Paper>('tabloid-landscape')
  const [format, setFormat] = useState<Format>(() =>
    'detail'
  )
  const [groupByLocation, setGroupByLocation] = useState(
    () => params.get('byLocation') !== '0'
  )

  const [stages, setStages] = useState<LeadStage[]>(() => {
    const requested = params.get('stage') as LeadStage
    return LEAD_STAGE_ORDER.includes(requested) ? [requested] : readSelection('leads:print:stages',LEAD_STAGE_ORDER,LEAD_STAGE_ORDER.filter(s => s !== 'completed' && s !== 'lost'))
  })
  const [fields, setFields] = useState<ReportField[]>(() => readSelection('leads:print:fields',REPORT_FIELDS,DEFAULT_FIELDS))
  const [fullDescription, setFullDescription] = useState(false)
  useEffect(() => { try { localStorage.setItem('leads:print:stages',JSON.stringify(stages)); localStorage.setItem('leads:print:fields',JSON.stringify(fields)) } catch { /* unavailable storage */ } },[stages,fields])

  /* ---------- filters carried over from the Leads page ---------- */

  const showArchived = params.get('archived') === '1'
  const search = params.get('q')?.trim().toLowerCase() ?? ''
  const townFilter = params.get('town') ?? 'all'
  const regionFilter = params.get('region') ?? 'all'
  const stageFilter = 'all'
  const dateField = (params.get('dateField') ?? 'none') as DateField
  const dateFrom = params.get('from') ?? ''
  const dateTo = params.get('to') ?? ''

  /* ---------- load ---------- */

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [leads, cs] = await Promise.all([listLeads(), loadCompanySettings()])
        if (cancelled) return
        setRows(leads)
        setSettings(cs)
        if (cs.company_logo_path) {
          const { data } = await supabase.storage
            .from('company-assets')
            .createSignedUrl(cs.company_logo_path, 60 * 60)
          if (!cancelled && data?.signedUrl) setLogoUrl(data.signedUrl)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Unknown error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------- filtering (mirrors Leads.tsx) ---------- */

  const filtered = useMemo(() => {
    if (!rows) return null
    return rows.filter((r) => {
      if (!showArchived && r.project?.status === 'archived') return false
      if (townFilter !== 'all' && (r.town?.trim() ?? '') !== townFilter) return false
      if (regionFilter !== 'all' && (r.region ?? '') !== regionFilter) return false
      if (search) {
        const haystack = [
          r.project_name,
          r.name,
          r.description,
          r.region,
          r.town,
          r.job_address,
          r.source,
          r.email,
          r.phone,
          r.project?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      if (dateField !== 'none' && (dateFrom || dateTo)) {
        const value =
          dateField === 'created'
            ? r.created_at
            : dateField === 'follow_up'
              ? r.follow_up_date
              : r.last_presented_at
        if (!value) return false
        const day = value.slice(0, 10)
        if (dateFrom && day < dateFrom) return false
        if (dateTo && day > dateTo) return false
      }
      return true
    })
  }, [rows, showArchived, search, townFilter, regionFilter, dateField, dateFrom, dateTo])

  const reportRows = useMemo(() => filtered?.filter(r => stages.includes(r.stage)) ?? null,[filtered,stages])

  /**
   * There is no way to hand a browser a finished PDF from client-side
   * markup without rasterising it (html2canvas et al), which would
   * turn 8pt table text into mush at 11x17. So "Download PDF" opens the
   * native print dialog, where Destination → Save as PDF produces real
   * vector text at the exact page size we asked for. The toolbar text
   * says so plainly rather than pretending otherwise.
   */
  const handleDownload = useCallback(() => window.print(), [])

  // Always show the preview first so Download PDF cannot bypass report choices.

  /* ---------- guards ---------- */

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load the report: {loadError}
        </div>
        <Link
          to="/app/leads"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Leads &amp; Bids
        </Link>
      </div>
    )
  }

  if (!reportRows || !settings) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-sm text-gray-500">
        Building the report…
      </div>
    )
  }

  const accent = settings.pdf_primary_color || '#1e3a8a'
  const sheetWidth = PAPER_META[paper].width

  return (
    <>
      <style>{printCss(PAPER_META[paper].css)}</style>

      <div className="lpv-root min-h-screen bg-gray-100 print:bg-white">
        {/* ───── Toolbar — screen only ───── */}
        <div className="lpv-toolbar sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate('/app/leads')}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Leads &amp; Bids
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                ariaLabel="Report format"
                value={format}
                onChange={(v) => setFormat(v as Format)}
                options={(Object.keys(FORMAT_META) as Format[]).map((f) => ({
                  value: f,
                  label: FORMAT_META[f].label,
                  title: FORMAT_META[f].blurb,
                }))}
              />
              <SegmentedControl
                ariaLabel="Paper size"
                value={paper}
                onChange={(v) => setPaper(v as Paper)}
                options={(Object.keys(PAPER_META) as Paper[]).map((p) => ({
                  value: p,
                  label: PAPER_META[p].label,
                  title: PAPER_META[p].blurb,
                }))}
              />
              <label className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={groupByLocation}
                  onChange={(e) => setGroupByLocation(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                By location
              </label>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </button>
            </div>
          </div>
          <div className="mx-auto mt-3 max-w-[1560px] space-y-2 text-sm">
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border p-2"><legend className="px-1 font-semibold">Stage columns to include</legend>
              {LEAD_STAGE_ORDER.map(stage => <label key={stage} className="flex items-center gap-1"><input type="checkbox" checked={stages.includes(stage)} disabled={stages.length === 1 && stages.includes(stage)} onChange={e => setStages(prev => LEAD_STAGE_ORDER.filter(v => v === stage ? e.target.checked : prev.includes(v)))} />{LEAD_STAGE_CONFIG[stage].label}</label>)}
              <button className="text-blue-700 underline" onClick={() => setStages(LEAD_STAGE_ORDER.filter(s => s !== 'completed' && s !== 'lost'))}>Active stages</button><button className="text-blue-700 underline" onClick={() => setStages([...LEAD_STAGE_ORDER])}>All stages</button>
            </fieldset>
            {format !== 'summary' && <details><summary className="cursor-pointer font-semibold">Fields to print ({fields.length})</summary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{REPORT_FIELDS.map(field => <label key={field} className="flex items-center gap-1"><input type="checkbox" checked={fields.includes(field)} disabled={field === 'Project Name'} onChange={e => setFields(prev => REPORT_FIELDS.filter(v => v === field ? e.target.checked : prev.includes(v)))} />{field}</label>)}<button className="text-blue-700 underline" onClick={() => setFields([...REPORT_FIELDS])}>All fields</button><button className="text-blue-700 underline" onClick={() => setFields(DEFAULT_FIELDS)}>Meeting fields</button></div>
              <label className="mt-2 flex items-center gap-1"><input type="checkbox" checked={fullDescription} onChange={e => setFullDescription(e.target.checked)} />Print full descriptions (may add pages)</label>
            </details>}
          </div>
          <p className="mx-auto mt-2 max-w-[1560px] text-xs text-gray-500">
            {FORMAT_META[format].blurb} · {PAPER_META[paper].blurb}. In the dialog
            choose Destination: <strong>Save as PDF</strong>, Paper:{' '}
            <strong>{PAPER_META[paper].label}</strong>, Margins: Default, Background
            graphics: <strong>on</strong> (needed for the stage headers and the
            pool shading).
          </p>
        </div>

        {/* ───── The sheet ───── */}
        <div
          className="lpv-sheet mx-auto my-6 bg-white p-8 shadow-sm print:my-0 print:p-0 print:shadow-none"
          style={{ maxWidth: sheetWidth }}
        >
          <ReportHeader
            settings={settings}
            logoUrl={logoUrl}
            accent={accent}
            rows={reportRows}
            allRows={filtered ?? []}
            stages={stages}
            fullDescription={fullDescription}
            filterSummary={describeFilters({
              search,
              townFilter,
              regionFilter,
              stageFilter,
              dateField,
              dateFrom,
              dateTo,
              format,
            }) + " · Stages: " + stages.map(s => LEAD_STAGE_CONFIG[s].label).join(", ")}
          />

          {reportRows.length === 0 ? (
            <p className="mt-8 text-sm text-gray-500">
              No leads match these filters.
            </p>
          ) : format === 'board' ? (
            <BoardSheet rows={reportRows} accent={accent} groupByLocation={groupByLocation} stages={stages} fields={fields} fullDescription={fullDescription} />
          ) : format === 'detail' ? (
            <DetailSheet rows={reportRows} accent={accent} groupByLocation={groupByLocation} stages={stages} fields={fields} fullDescription={fullDescription} />
          ) : (
            <SummarySheet rows={reportRows} accent={accent} stages={stages} />
          )}

          <footer className="lpv-footer mt-6 border-t border-gray-300 pt-2 text-[9pt] text-gray-500">
            {settings.company_legal_name || 'BidClaw'} · Leads &amp; Bids ·
            Generated {new Date().toLocaleString()} · Internal pipeline report
          </footer>
        </div>
      </div>
    </>
  )
}

/* ============================================================
 * Header — identity, title, and the numbers that matter at a glance
 * ============================================================ */

function ReportHeader({
  settings,
  logoUrl,
  accent,
  rows,
  allRows,
  filterSummary,
  stages,
  fullDescription,
}: {
  settings: CompanySettings
  logoUrl: string | null
  accent: string
  rows: LeadListRow[]
  allRows: LeadListRow[]
  filterSummary: string
  stages: LeadStage[]
  fullDescription: boolean
}) {
  // Headline number excludes Lost on purpose — a pipeline total that
  // counts dead jobs is the number nobody trusts. Lost still shows in
  // its own board column / summary row.
  const live = rows.filter((r) => r.stage !== 'lost')
  const pool = rows.filter(isPoolWork)
  const overdue = rows.filter((r) => isOverdue(r.follow_up_date))

  return (
    <header className="lpv-header">
      <div className="flex items-start justify-between gap-6 border-b-2 pb-3" style={{ borderColor: accent }}>
        <div className="flex items-start gap-3">
          {logoUrl && (
            <img src={logoUrl} alt="" className="h-12 w-auto object-contain" />
          )}
          <div>
            <h1 className="text-[18pt] font-extrabold leading-tight" style={{ color: accent }}>
              Leads &amp; Bids — Pipeline Report
            </h1>
            <p className="text-[10pt] font-semibold text-gray-700">
              {settings.company_legal_name || 'BidClaw'}
            </p>
            <p className="text-[8.5pt] text-gray-500">{filterSummary}</p>
          </div>
        </div>
        <div className="text-right text-[8.5pt] text-gray-600">
          <div className="font-semibold text-gray-800">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          <div>
            {rows.length} of {allRows.length} lead{allRows.length === 1 ? '' : 's'} shown
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-3">
        {stages.map(stage => {
          const stageRows = rows.filter(r => r.stage === stage)
          return <Kpi key={stage} label={`${LEAD_STAGE_CONFIG[stage].label} (${stageRows.length})`} value={formatMoney(sumValue(stageRows))} accent={accent} />
        })}
      </div>
      <p className="mt-2 text-[8.5pt] text-gray-600">Selected stages total excluding Lost: <strong>{formatMoney(sumValue(live))}</strong> · Follow-ups overdue: {overdue.length}. Each total matches its named column. {fullDescription ? 'Full descriptions printed.' : 'Descriptions shortened for printing; full notes remain in BidClaw.'}</p>

      {/* Only shown when there's actually something shaded — a legend for
          a colour that never appears is just noise on the sheet. */}
      {pool.length > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[8.5pt] text-gray-600">
          <span className="inline-block h-3 w-6 rounded-sm border border-brand-pool-border bg-brand-pool" />
          <span>
            {POOL_LEGEND} — {pool.length} of {rows.length}, {formatMoney(sumValue(pool))}
          </span>
        </div>
      )}
    </header>
  )
}

function Kpi({
  label,
  value,
  accent,
  big,
}: {
  label: string
  value: string
  accent: string
  big?: boolean
}) {
  return (
    <div className="rounded-md border border-gray-300 px-3 py-2">
      <div className="text-[7.5pt] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={big ? 'text-[15pt] font-extrabold leading-tight' : 'text-[12pt] font-bold leading-tight'}
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  )
}

/* ============================================================
 * Board format — the pipeline across the sheet
 * ============================================================ */

function BoardSheet({
  rows,
  accent,
  groupByLocation,
  stages, fields, fullDescription,
}: {
  stages: LeadStage[]
  fields: ReportField[]
  fullDescription: boolean
  rows: LeadListRow[]
  accent: string
  groupByLocation: boolean
}) {
  return (
    <div className="lpv-board mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((stage) => {
        const cards = rows.filter((r) => r.stage === stage)
        const groups = groupByLocation ? locationBuckets(cards) : null
        return (
          <section key={stage} className="lpv-column rounded-md border border-gray-300">
            <div
              className="rounded-t-[5px] px-2 py-1.5 text-white"
              style={{ backgroundColor: accent }}
            >
              <div className="text-[9pt] font-bold uppercase leading-tight tracking-wide">
                {LEAD_STAGE_CONFIG[stage].label}
              </div>
              {/* flex-wrap, not justify-between on one line — in portrait
                  the columns get narrow enough that a 7-figure total
                  would otherwise run past the column edge. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[8pt] opacity-90">
                <span className="whitespace-nowrap">
                  {cards.length} lead{cards.length === 1 ? '' : 's'}
                </span>
                <span className="whitespace-nowrap font-bold">
                  {formatMoney(sumValue(cards))}
                </span>
              </div>
            </div>
            <div className="space-y-1 p-1.5">
              {cards.length === 0 && (
                <div className="py-2 text-center text-[8pt] italic text-gray-400">—</div>
              )}
              {groups
                ? groups.map((g) => (
                    <div key={g.key} className="space-y-1">
                      <div className="flex items-baseline justify-between border-b border-gray-200 pb-0.5 text-[7.5pt] font-bold uppercase tracking-wide text-gray-500">
                        <span>{g.label}</span>
                        <span>{formatMoney(g.total)}</span>
                      </div>
                      {g.cards.map((lead) => (
                        <BoardCard key={lead.id} lead={lead} fields={fields} fullDescription={fullDescription} />
                      ))}
                    </div>
                  ))
                : cards.map((lead) => <BoardCard key={lead.id} lead={lead} fields={fields} fullDescription={fullDescription} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function reportValue(lead: LeadListRow, field: ReportField, full: boolean): string {
  switch(field) {
    case 'Project Name': return leadTitle(lead)
    case 'Address': return [lead.job_address,lead.town].filter(Boolean).join(', ')
    case 'Description': return lead.description ? (full ? lead.description : clipDescription(lead.description,150)) : ''
    case 'Created': return formatShortDate(lead.created_at)
    case 'Location': return lead.region ? (LEAD_REGION_CONFIG[lead.region]?.label ?? lead.region) : ''
    case 'Source': return lead.source ?? ''
    case 'Contact': return lead.name ?? ''
    case 'Phone / Email': return [lead.phone,lead.email].filter(Boolean).join(' · ')
    case 'Follow-up': return lead.follow_up_date ? `${isOverdue(lead.follow_up_date) ? 'OVERDUE ' : ''}${formatShortDate(lead.follow_up_date)}` : ''
    case 'Proposals': return String(lead.proposal_count || 0)
    case 'Proposal sent': return lead.last_presented_at ? formatShortDate(lead.last_presented_at) : ''
    case 'Stage': return LEAD_STAGE_CONFIG[lead.stage].label
    case 'Value': return formatMoney(Number(lead.est_value)||0)
  }
}
function BoardCard({lead,fields,fullDescription}:{lead:LeadListRow;fields:ReportField[];fullDescription:boolean}) {
  return <div className={`lpv-card break-words rounded border px-1.5 py-1 text-[8pt] leading-snug ${isPoolWork(lead) ? POOL_CARD_CLASSES : 'border-gray-300'}`}>
    {fields.map(field => {const value = reportValue(lead,field,fullDescription); return value ? <div key={field} className={field === 'Project Name' || field === 'Value' ? 'font-bold text-gray-900' : 'text-gray-600'}>{field !== 'Project Name' && <span className="font-medium">{field}: </span>}{value}</div> : null})}
  </div>
}

/* ============================================================
 * Detail format — every lead as a row
 * ============================================================ */

function fieldWidth(field: ReportField) { return field === 'Project Name' ? 22 : field === 'Description' ? 26 : field === 'Address' || field === 'Phone / Email' ? 18 : field === 'Source' || field === 'Contact' ? 14 : 10 }
function DetailSheet({rows,accent,groupByLocation,stages,fields,fullDescription}:{rows:LeadListRow[];accent:string;groupByLocation:boolean;stages:LeadStage[];fields:ReportField[];fullDescription:boolean}) {
  const sections = stages.flatMap(stage => { const cards = rows.filter(r => r.stage === stage); return groupByLocation ? locationBuckets(cards).map(g => ({...g,key:stage+g.key,label:LEAD_STAGE_CONFIG[stage].label+' — '+g.label})) : [{key:stage,label:LEAD_STAGE_CONFIG[stage].label,cards,total:sumValue(cards)}] }).filter(s => s.cards.length)
  return <table className="lpv-table mt-4 w-full table-fixed border-collapse text-[8pt]">
    <colgroup>{fields.map(f => <col key={f} style={{width:`${fieldWidth(f)/fields.reduce((n,x)=>n+fieldWidth(x),0)*100}%`}} />)}</colgroup>
    <thead><tr style={{backgroundColor:accent}} className="text-white">{fields.map(field => <th key={field} className="border border-gray-400 px-1.5 py-1 text-left font-bold">{field}</th>)}</tr></thead>
    <tbody>{sections.map(section => <SectionRows key={section.key} section={section} fields={fields} fullDescription={fullDescription} />)}
      <tr className="lpv-grand"><td colSpan={fields.length} className="border border-gray-400 p-2 text-right font-extrabold">Total — {rows.length} leads · {formatMoney(sumValue(rows))}</td></tr>
    </tbody>
  </table>
}
function SectionRows({section,fields,fullDescription}:{section:{key:string;label:string;cards:LeadListRow[];total:number};fields:ReportField[];fullDescription:boolean}) {
  return <><tr className="lpv-band"><td colSpan={fields.length} className="border border-gray-400 bg-gray-100 p-2 font-bold">{section.label} — {section.cards.length} leads · {formatMoney(section.total)}</td></tr>
    {section.cards.map(lead => <tr key={lead.id} className={`lpv-row align-top ${isPoolWork(lead) ? POOL_ROW_CLASSES : ''}`}>{fields.map(field => <td key={field} className="border border-gray-300 px-1.5 py-1" style={{overflowWrap:'anywhere'}}>{reportValue(lead,field,fullDescription)||'—'}</td>)}</tr>)}</>
}

/* ============================================================
 * Summary format — stage × location matrix, no rows
 * ============================================================ */

function SummarySheet({ rows, accent, stages }: { rows: LeadListRow[]; accent: string; stages: LeadStage[] }) {
  // Canonical territories first, then any custom ones actually present,
  // then a "No location" column if anything is missing a region.
  const canonical: string[] = [...LEAD_REGION_ORDER]
  const custom = [
    ...new Set(
      rows.map((r) => r.region).filter((r): r is string => !!r && !canonical.includes(r))
    ),
  ].sort((a, b) => a.localeCompare(b))
  const hasNone = rows.some((r) => !r.region)
  const cols: Array<string | null> = [...canonical, ...custom, ...(hasNone ? [null] : [])]
  const label = (c: string | null) =>
    c === null ? 'No location' : (LEAD_REGION_CONFIG[c]?.label ?? c)
  const cell = (stage: LeadStage, col: string | null) =>
    rows.filter((r) => r.stage === stage && (col === null ? !r.region : r.region === col))

  return (
    <table className="lpv-table mt-4 w-full border-collapse text-[10pt]">
      <thead>
        <tr style={{ backgroundColor: accent }} className="text-white">
          <th className="border border-gray-400 px-2 py-1.5 text-left font-bold uppercase tracking-wide">
            Stage
          </th>
          {cols.map((c) => (
            <th
              key={c ?? '__none__'}
              className="border border-gray-400 px-2 py-1.5 text-right font-bold uppercase tracking-wide"
            >
              {label(c)}
            </th>
          ))}
          <th className="border border-gray-400 px-2 py-1.5 text-right font-bold uppercase tracking-wide">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {stages.map((stage) => {
          const stageRows = rows.filter((r) => r.stage === stage)
          return (
            <tr key={stage}>
              <td className="border border-gray-300 px-2 py-1.5 font-bold text-gray-900">
                {LEAD_STAGE_CONFIG[stage].label}
              </td>
              {cols.map((c) => {
                const bucket = cell(stage, c)
                return (
                  <td
                    key={c ?? '__none__'}
                    className="border border-gray-300 px-2 py-1.5 text-right text-gray-700"
                  >
                    {bucket.length === 0 ? (
                      '—'
                    ) : (
                      <>
                        <span className="font-semibold text-gray-900">
                          {formatMoney(sumValue(bucket))}
                        </span>
                        <span className="ml-1 text-[8pt] text-gray-500">({bucket.length})</span>
                      </>
                    )}
                  </td>
                )
              })}
              <td className="border border-gray-300 px-2 py-1.5 text-right font-bold text-gray-900">
                {stageRows.length === 0 ? '—' : formatMoney(sumValue(stageRows))}
              </td>
            </tr>
          )
        })}
        <tr className="lpv-grand">
          <td className="border border-gray-400 px-2 py-1.5 font-extrabold uppercase tracking-wide">
            Total
          </td>
          {cols.map((c) => {
            const bucket = rows.filter((r) => (c === null ? !r.region : r.region === c))
            return (
              <td
                key={c ?? '__none__'}
                className="border border-gray-400 px-2 py-1.5 text-right font-extrabold"
              >
                {bucket.length === 0 ? '—' : formatMoney(sumValue(bucket))}
              </td>
            )
          })}
          <td className="border border-gray-400 px-2 py-1.5 text-right font-extrabold">
            {formatMoney(sumValue(rows))}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/* ============================================================
 * Shared bits
 * ============================================================ */

function SegmentedControl({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; title: string }[]
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
            value === o.value
              ? 'bg-brand-navy text-white shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Location sections in sheet order — mirrors Leads.tsx locationBuckets. */
function locationBuckets(cards: LeadListRow[]): Array<{
  key: string
  label: string
  cards: LeadListRow[]
  total: number
}> {
  const canonical: string[] = [...LEAD_REGION_ORDER]
  const custom = [
    ...new Set(
      cards.map((c) => c.region).filter((r): r is string => !!r && !canonical.includes(r))
    ),
  ].sort((a, b) => a.localeCompare(b))
  const order: Array<string | null> = [...canonical, ...custom, null]
  return order
    .map((loc) => {
      const bucket = cards.filter((c) => (loc === null ? !c.region : c.region === loc))
      return {
        key: loc ?? '__none__',
        label: loc === null ? 'No location' : (LEAD_REGION_CONFIG[loc]?.label ?? loc),
        cards: bucket,
        total: sumValue(bucket),
      }
    })
    .filter((g) => g.cards.length > 0)
}

/** One line under the title saying exactly what this sheet is showing. */
function describeFilters(o: {
  search: string
  townFilter: string
  regionFilter: string
  stageFilter: string
  dateField: DateField
  dateFrom: string
  dateTo: string
  format: Format
}): string {
  const parts: string[] = []
  if (o.regionFilter !== 'all') {
    parts.push(LEAD_REGION_CONFIG[o.regionFilter]?.label ?? o.regionFilter)
  }
  if (o.townFilter !== 'all') parts.push(o.townFilter)
  if (o.format !== 'board' && o.stageFilter !== 'all') {
    parts.push(LEAD_STAGE_CONFIG[o.stageFilter as LeadStage]?.label ?? o.stageFilter)
  }
  if (o.dateField !== 'none' && (o.dateFrom || o.dateTo)) {
    const field =
      o.dateField === 'created'
        ? 'Created'
        : o.dateField === 'follow_up'
          ? 'Follow-up'
          : 'Proposal sent'
    parts.push(`${field} ${o.dateFrom || '…'} → ${o.dateTo || '…'}`)
  }
  if (o.search) parts.push(`matching "${o.search}"`)
  return parts.length > 0 ? parts.join(' · ') : 'All leads, no filters applied'
}

function sumValue(rows: LeadListRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.est_value) || 0), 0)
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function isOverdue(followUpDate: string | null): boolean {
  if (!followUpDate) return false
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return followUpDate < today
}

/**
 * Descriptions in the wild are multi-paragraph notes — one live lead runs
 * ~2,000 characters. Left whole, a single row swallows a whole sheet and
 * throws the column widths out. Both board cards and detail rows use a readable excerpt at a word boundary.
 */
function clipDescription(text: string, max = 95): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

/* ============================================================
 * Print CSS — @page size follows the paper toggle
 *
 * Namespaced under .lpv-* so nothing bleeds into the rest of the app.
 * Key rules: repeat the table header on every sheet, never split a
 * board column or a row mid-page, and force the accent fills to print
 * (Chrome drops backgrounds unless print-color-adjust says otherwise).
 * ============================================================ */

function printCss(pageSize: string): string {
  return `
.lpv-card { overflow-wrap: anywhere; }
.lpv-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; line-height: 1.375; max-height: 4.125em; overflow: hidden; overflow-wrap: anywhere; }
@media print {
  @page {
    size: ${pageSize};
    margin: 0.4in;
  }

  html, body {
    background: white !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .lpv-root { background: white !important; }
  .lpv-toolbar { display: none !important; }

  .lpv-sheet {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    background: white !important;
  }

  /* Header block repeats nothing — it's a cover band, keep it whole */
  .lpv-header { break-inside: avoid; page-break-inside: avoid; }

  /* Board: individual cards stay whole, but a COLUMN must be free to
     fragment across sheets. With real data one stage holds 24 leads —
     taller than 11in — and break-inside:avoid on the column made Chrome
     give every single stage its own sheet. Do not set this to avoid. */
  .lpv-column { break-inside: auto; page-break-inside: auto; }
  .lpv-card   { break-inside: avoid; page-break-inside: avoid; }

  /* Detail table: repeat the header row, keep rows and section bands
     whole, and never orphan a band at the bottom of a sheet. */
  .lpv-table thead { display: table-header-group; }
  .lpv-table tfoot { display: table-footer-group; }
  .lpv-row,
  .lpv-grand { break-inside: avoid; page-break-inside: avoid; }
  .lpv-band  { break-inside: avoid; break-after: avoid; page-break-after: avoid; }

  .lpv-grand { background: #f3f4f6 !important; }

  .lpv-footer { break-inside: avoid; page-break-inside: avoid; }
}
`
}
