import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  detail: { label: 'Detail', blurb: 'Every lead as a row, with subtotals' },
  summary: { label: 'Summary', blurb: 'One sheet — stage × location rollup' },
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
    params.get('view') === 'list' ? 'detail' : 'board'
  )
  const [groupByLocation, setGroupByLocation] = useState(
    () => params.get('byLocation') === '1'
  )

  /* ---------- filters carried over from the Leads page ---------- */

  const search = params.get('q')?.trim().toLowerCase() ?? ''
  const townFilter = params.get('town') ?? 'all'
  const regionFilter = params.get('region') ?? 'all'
  const stageFilter = params.get('stage') ?? 'all'
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
  }, [rows, search, townFilter, regionFilter, dateField, dateFrom, dateTo])

  // The stage filter applies to the row-based formats only — the board
  // always shows every column, same rule as the app.
  const reportRows = useMemo(() => {
    if (!filtered) return null
    if (format === 'board' || stageFilter === 'all') return filtered
    return filtered.filter((r) => r.stage === stageFilter)
  }, [filtered, format, stageFilter])

  /**
   * There is no way to hand a browser a finished PDF from client-side
   * markup without rasterising it (html2canvas et al), which would
   * turn 8pt table text into mush at 11x17. So "Download PDF" opens the
   * native print dialog, where Destination → Save as PDF produces real
   * vector text at the exact page size we asked for. The toolbar text
   * says so plainly rather than pretending otherwise.
   */
  const handleDownload = useCallback(() => window.print(), [])

  // ?auto=1 — the Leads page's Download PDF button lands here and wants
  // the dialog straight away. Fires once, after the sheet has painted,
  // and only when there's something to show.
  // A ref, not state — firing the dialog is a side effect on an external
  // system, and nothing renders differently once it has happened.
  const autoFired = useRef(false)
  useEffect(() => {
    if (autoFired.current || params.get('auto') !== '1') return
    if (!rows || !settings) return
    autoFired.current = true
    const t = window.setTimeout(() => window.print(), 350)
    return () => window.clearTimeout(t)
  }, [params, rows, settings])

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
          <p className="mx-auto mt-2 max-w-[1560px] text-xs text-gray-500">
            {FORMAT_META[format].blurb} · {PAPER_META[paper].blurb}. In the dialog
            choose Destination: <strong>Save as PDF</strong>, Paper:{' '}
            <strong>Tabloid / 11×17</strong>, Margins: Default, Background
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
            filterSummary={describeFilters({
              search,
              townFilter,
              regionFilter,
              stageFilter,
              dateField,
              dateFrom,
              dateTo,
              format,
            })}
          />

          {reportRows.length === 0 ? (
            <p className="mt-8 text-sm text-gray-500">
              No leads match these filters.
            </p>
          ) : format === 'board' ? (
            <BoardSheet rows={reportRows} accent={accent} groupByLocation={groupByLocation} />
          ) : format === 'detail' ? (
            <DetailSheet rows={reportRows} accent={accent} groupByLocation={groupByLocation} />
          ) : (
            <SummarySheet rows={reportRows} accent={accent} />
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
}: {
  settings: CompanySettings
  logoUrl: string | null
  accent: string
  rows: LeadListRow[]
  allRows: LeadListRow[]
  filterSummary: string
}) {
  // Headline number excludes Lost on purpose — a pipeline total that
  // counts dead jobs is the number nobody trusts. Lost still shows in
  // its own board column / summary row.
  const live = rows.filter((r) => r.stage !== 'lost')
  const pool = rows.filter(isPoolWork)
  // "Open" = everything still live: not signed-through-completed, not lost.
  const open = rows.filter((r) => ['lead', 'pending', 'estimating', 'proposed'].includes(r.stage))
  const proposed = rows.filter((r) => r.stage === 'proposed')
  const signed = rows.filter((r) => ['signed', 'in_progress', 'completed'].includes(r.stage))
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

      <div className="mt-3 grid grid-cols-5 gap-3">
        <Kpi
          label="Pipeline (excl. Lost)"
          value={formatMoney(sumValue(live))}
          accent={accent}
          big
        />
        <Kpi label={`Open (${open.length})`} value={formatMoney(sumValue(open))} accent={accent} />
        <Kpi label={`Proposed (${proposed.length})`} value={formatMoney(sumValue(proposed))} accent={accent} />
        <Kpi label={`Signed+ (${signed.length})`} value={formatMoney(sumValue(signed))} accent={accent} />
        <Kpi
          label="Follow-ups overdue"
          value={String(overdue.length)}
          accent={overdue.length > 0 ? '#be123c' : accent}
        />
      </div>

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
}: {
  rows: LeadListRow[]
  accent: string
  groupByLocation: boolean
}) {
  return (
    <div className="lpv-board mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${LEAD_STAGE_ORDER.length}, minmax(0, 1fr))` }}>
      {LEAD_STAGE_ORDER.map((stage) => {
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
                        <BoardCard key={lead.id} lead={lead} />
                      ))}
                    </div>
                  ))
                : cards.map((lead) => <BoardCard key={lead.id} lead={lead} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({ lead }: { lead: LeadListRow }) {
  const overdue = isOverdue(lead.follow_up_date)
  const value = Number(lead.est_value) || 0
  const where = [lead.job_address, lead.town].filter(Boolean).join(', ')
  const pool = isPoolWork(lead)
  return (
    <div
      className={`lpv-card rounded border px-1.5 py-1 text-[8pt] leading-snug ${
        pool ? POOL_CARD_CLASSES : 'border-gray-300'
      }`}
    >
      <div className="font-bold text-gray-900">{leadTitle(lead)}</div>
      {where && <div className="text-gray-600">{where}</div>}
      {lead.description && <div className="text-gray-600">{lead.description}</div>}
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-1">
        <span className="text-[7.5pt] uppercase tracking-wide text-gray-500">
          {lead.region ? (LEAD_REGION_CONFIG[lead.region]?.label ?? lead.region) : '—'}
        </span>
        {value > 0 && (
          <span className="whitespace-nowrap font-bold text-gray-900">{formatMoney(value)}</span>
        )}
      </div>
      {lead.follow_up_date && (
        <div className={overdue ? 'font-bold text-rose-700' : 'text-gray-600'}>
          {overdue ? 'OVERDUE ' : 'Follow up '}
          {formatShortDate(lead.follow_up_date)}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * Detail format — every lead as a row
 * ============================================================ */

const DETAIL_COLS = [
  'Project Name',
  'Address',
  'Description',
  'Created',
  'Location',
  'Source',
  'Contact',
  'Phone / Email',
  'Follow-up',
  'Proposals',
  'Value',
] as const

function DetailSheet({
  rows,
  accent,
  groupByLocation,
}: {
  rows: LeadListRow[]
  accent: string
  groupByLocation: boolean
}) {
  // Group by location when asked, otherwise by stage — a printed sheet
  // wants explicit section bands, not a colour-coded badge column.
  const sections = groupByLocation
    ? locationBuckets(rows)
    : LEAD_STAGE_ORDER.map((stage) => {
        const cards = rows.filter((r) => r.stage === stage)
        return {
          key: stage,
          label: LEAD_STAGE_CONFIG[stage].label,
          cards,
          total: sumValue(cards),
        }
      }).filter((s) => s.cards.length > 0)

  return (
    <table className="lpv-table mt-4 w-full border-collapse text-[8pt]">
      <thead>
        <tr style={{ backgroundColor: accent }} className="text-white">
          {DETAIL_COLS.map((c) => (
            <th
              key={c}
              className={`border border-gray-400 px-1.5 py-1 text-left font-bold uppercase tracking-wide ${
                c === 'Value' ? 'text-right' : ''
              }`}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => (
          <SectionRows key={section.key} section={section} />
        ))}
        <tr className="lpv-grand">
          <td
            colSpan={DETAIL_COLS.length - 1}
            className="border border-gray-400 px-1.5 py-1 text-right text-[9pt] font-extrabold uppercase tracking-wide"
          >
            Total — {rows.length} lead{rows.length === 1 ? '' : 's'}
          </td>
          <td className="border border-gray-400 px-1.5 py-1 text-right text-[9pt] font-extrabold">
            {formatMoney(sumValue(rows))}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function SectionRows({
  section,
}: {
  section: { key: string; label: string; cards: LeadListRow[]; total: number }
}) {
  return (
    <>
      <tr className="lpv-band">
        <td
          colSpan={DETAIL_COLS.length - 1}
          className="border border-gray-400 bg-gray-100 px-1.5 py-1 text-[8.5pt] font-extrabold uppercase tracking-wide text-gray-800"
        >
          {section.label} — {section.cards.length}
        </td>
        <td className="border border-gray-400 bg-gray-100 px-1.5 py-1 text-right text-[8.5pt] font-extrabold text-gray-900">
          {formatMoney(section.total)}
        </td>
      </tr>
      {section.cards.map((lead) => {
        const overdue = isOverdue(lead.follow_up_date)
        const value = Number(lead.est_value) || 0
        const pool = isPoolWork(lead)
        return (
          <tr key={lead.id} className={`lpv-row align-top ${pool ? POOL_ROW_CLASSES : ''}`}>
            <td className="border border-gray-300 px-1.5 py-1 font-semibold text-gray-900">
              {leadTitle(lead)}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {[lead.job_address, lead.town].filter(Boolean).join(', ') || '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {lead.description ?? '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 whitespace-nowrap text-gray-700">
              {formatShortDate(lead.created_at)}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {lead.region ? (LEAD_REGION_CONFIG[lead.region]?.label ?? lead.region) : '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {lead.source ?? '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {lead.name ?? '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-gray-700">
              {[lead.phone, lead.email].filter(Boolean).join(' · ') || '—'}
            </td>
            <td
              className={`border border-gray-300 px-1.5 py-1 whitespace-nowrap ${
                overdue ? 'font-bold text-rose-700' : 'text-gray-700'
              }`}
            >
              {lead.follow_up_date ? formatShortDate(lead.follow_up_date) : '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-center text-gray-700">
              {lead.proposal_count || '—'}
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-right font-semibold text-gray-900">
              {value > 0 ? formatMoney(value) : '—'}
            </td>
          </tr>
        )
      })}
    </>
  )
}

/* ============================================================
 * Summary format — stage × location matrix, no rows
 * ============================================================ */

function SummarySheet({ rows, accent }: { rows: LeadListRow[]; accent: string }) {
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
        {LEAD_STAGE_ORDER.map((stage) => {
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

  /* Board: keep a stage column together; let cards break if a column
     is genuinely taller than the sheet. */
  .lpv-column { break-inside: avoid; page-break-inside: avoid; }
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
