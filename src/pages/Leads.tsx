import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  ClipboardList,
  Columns3,
  GripVertical,
  Inbox,
  List,
  MapPin,
  Plus,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewLeadModal } from '@/components/leads/NewLeadModal'
import { ConvertLeadModal } from '@/components/leads/ConvertLeadModal'
import { leadTitle, listLeads, updateLead } from '@/lib/leads'
import {
  LEAD_REGION_CONFIG,
  LEAD_REGION_FALLBACK,
  LEAD_REGION_ORDER,
  LEAD_STAGE_CONFIG,
  LEAD_STAGE_ORDER,
} from '@/lib/statusConfig'
import { cn } from '@/lib/utils'
import type { LeadListRow, LeadStage } from '@/lib/types'

type View = 'board' | 'list'
type StageFilter = 'all' | LeadStage
type DateField = 'none' | 'created' | 'follow_up' | 'presented'

export default function LeadsPage() {
  const [rows, setRows] = useState<LeadListRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')
  // Sheet-fidelity: the dashboard splits Proposed/Signed into literal
  // per-location sections. When on, board columns and the list render
  // location sections (Cape Cod / Nantucket / Metro Boston / …) with
  // their own subtotals. Sticky preference.
  const [groupByLocation, setGroupByLocation] = useState(() => {
    try {
      return localStorage.getItem('leads:groupByLocation') === '1'
    } catch {
      return false
    }
  })
  const toggleGroupByLocation = () =>
    setGroupByLocation((v) => {
      try {
        localStorage.setItem('leads:groupByLocation', v ? '0' : '1')
      } catch {
        /* private mode etc. — toggle still works for the session */
      }
      return !v
    })
  const [search, setSearch] = useState('')
  const [townFilter, setTownFilter] = useState('all')
  const [regionFilter, setRegionFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [dateField, setDateField] = useState<DateField>('none')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  // Set when a board/list stage move targets 'lost' — confirm first.
  const [pendingLost, setPendingLost] = useState<LeadListRow | null>(null)
  // Set when an unconverted lead is dragged onto Estimating — converting
  // creates the estimate (it appears under Estimates), then the card
  // lands in the column.
  const [pendingConvert, setPendingConvert] = useState<LeadListRow | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setRows(await listLeads())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unknown error')
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Distinct towns present in the data, for the town filter. */
  const towns = useMemo(() => {
    if (!rows) return []
    const set = new Set<string>()
    for (const r of rows) {
      const t = r.town?.trim()
      if (t) set.add(t)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  // Client-side filtering, same pattern as Projects.tsx. Stage filter
  // applies to the LIST view only — the board always shows every column.
  const filtered = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (townFilter !== 'all' && (r.town?.trim() ?? '') !== townFilter) return false
      if (regionFilter !== 'all' && (r.region ?? '') !== regionFilter) return false
      if (q) {
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
        if (!haystack.includes(q)) return false
      }
      if (dateField !== 'none' && (dateFrom || dateTo)) {
        const value =
          dateField === 'created'
            ? r.created_at
            : dateField === 'follow_up'
              ? r.follow_up_date
              : r.last_presented_at
        if (!value) return false
        const day = value.slice(0, 10) // compare YYYY-MM-DD lexically
        if (dateFrom && day < dateFrom) return false
        if (dateTo && day > dateTo) return false
      }
      return true
    })
  }, [rows, search, townFilter, regionFilter, dateField, dateFrom, dateTo])

  const listRows = useMemo(() => {
    if (!filtered) return null
    return stageFilter === 'all' ? filtered : filtered.filter((r) => r.stage === stageFilter)
  }, [filtered, stageFilter])

  /** Move a lead's stage with optimistic local update. */
  const moveStage = useCallback(
    async (lead: LeadListRow, target: LeadStage) => {
      if (target === lead.stage) return
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === lead.id ? { ...r, stage: target } : r)) : prev
      )
      try {
        await updateLead(lead.id, { stage: target })
        toast.success(`Moved to ${LEAD_STAGE_CONFIG[target].label}.`)
      } catch (e) {
        setRows((prev) =>
          prev ? prev.map((r) => (r.id === lead.id ? { ...r, stage: lead.stage } : r)) : prev
        )
        toast.error(e instanceof Error ? e.message : 'Move failed.')
      }
    },
    []
  )

  /**
   * Stage move handler (drag OR select). Lost requires a confirm (never
   * force it); dragging an UNCONVERTED lead onto Estimating opens the
   * convert flow — the estimate is created and appears under Estimates,
   * exactly like creating one there directly.
   */
  const requestMove = useCallback(
    (lead: LeadListRow, target: LeadStage) => {
      if (target === 'lost') {
        setPendingLost(lead)
        return
      }
      if (target === 'estimating' && !lead.project_id) {
        setPendingConvert(lead)
        return
      }
      void moveStage(lead, target)
    },
    [moveStage]
  )

  // Distance-gated pointer sensor so clicking links on a card still
  // navigates — a drag only starts after 8px of travel.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const lead = event.active.data.current?.lead as LeadListRow | undefined
      const target = event.over?.id as LeadStage | undefined
      if (!lead || !target || target === lead.stage) return
      requestMove(lead, target)
    },
    [requestMove]
  )

  const totalCount = rows?.length ?? 0
  const hasNoLeads = totalCount === 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
            Leads &amp; Bids
          </h1>
          <p className="mt-1 text-sm text-brand-text-muted">
            Every job starts here — drag cards through the pipeline from first
            call to signed and done.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-2 self-start rounded-md bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-gold-dark sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          New lead
        </button>
      </header>

      {/* Controls (hidden when zero leads) */}
      {!hasNoLeads && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {/* View toggle */}
              <div className="inline-flex overflow-hidden rounded-md border border-brand-border">
                <ViewButton active={view === 'board'} onClick={() => setView('board')} icon={Columns3} label="Board" />
                <ViewButton active={view === 'list'} onClick={() => setView('list')} icon={List} label="List" />
              </div>
              <div className="inline-flex overflow-hidden rounded-md border border-brand-border">
                <ViewButton
                  active={groupByLocation}
                  onClick={toggleGroupByLocation}
                  icon={MapPin}
                  label="By location"
                />
              </div>
              {view === 'list' && (
                <FilterSelect
                  value={stageFilter}
                  onChange={(v) => setStageFilter(v as StageFilter)}
                  options={[
                    { value: 'all', label: 'All stages' },
                    ...LEAD_STAGE_ORDER.map((s) => ({
                      value: s,
                      label: LEAD_STAGE_CONFIG[s].label,
                    })),
                  ]}
                />
              )}
              <FilterSelect
                value={regionFilter}
                onChange={setRegionFilter}
                options={[
                  { value: 'all', label: 'All locations' },
                  ...LEAD_REGION_ORDER.map((r) => ({
                    value: r,
                    label: LEAD_REGION_CONFIG[r].label,
                  })),
                ]}
              />
              <FilterSelect
                value={townFilter}
                onChange={setTownFilter}
                options={[
                  { value: 'all', label: 'All towns' },
                  ...towns.map((t) => ({ value: t, label: t })),
                ]}
              />
              <FilterSelect
                value={dateField}
                onChange={(v) => setDateField(v as DateField)}
                options={[
                  { value: 'none',      label: 'Any date' },
                  { value: 'created',   label: 'Created' },
                  { value: 'follow_up', label: 'Follow-up due' },
                  { value: 'presented', label: 'Proposal sent' },
                ]}
              />
              {dateField !== 'none' && (
                <>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    aria-label="From date"
                    className={dateInputClasses}
                  />
                  <span className="text-xs text-brand-text-muted">to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    aria-label="To date"
                    className={dateInputClasses}
                  />
                </>
              )}
            </div>
            <label className="relative block w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" />
              <input
                type="search"
                placeholder="Search project, name, town…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-brand-border bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-brand-text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              />
            </label>
          </div>
        </div>
      )}

      {/* Content */}
      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load leads: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && rows === null && (
        <div className="rounded-xl border border-brand-border bg-white p-6 text-sm text-brand-text-muted">
          Loading leads…
        </div>
      )}

      {!loadError && rows && hasNoLeads && (
        <EmptyState
          icon={Inbox}
          title="No leads yet"
          description="Add your first lead — every estimate, proposal, and signed job starts as a lead in the pipeline."
          ctaLabel="New lead"
          onCta={() => setNewOpen(true)}
        />
      )}

      {!loadError && filtered && !hasNoLeads && view === 'board' && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <LeadBoard rows={filtered} onMove={requestMove} groupByLocation={groupByLocation} />
        </DndContext>
      )}

      {!loadError && listRows && !hasNoLeads && view === 'list' && (
        <LeadList rows={listRows} onMove={requestMove} groupByLocation={groupByLocation} />
      )}

      <NewLeadModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          void load()
        }}
      />

      {pendingConvert && (
        <ConvertLeadModal
          open
          onClose={() => setPendingConvert(null)}
          lead={pendingConvert}
          onConverted={() => {
            setPendingConvert(null)
            toast.success('Estimate created — find it under Estimates.')
            void load()
          }}
        />
      )}

      <ConfirmDialog
        open={pendingLost !== null}
        onClose={() => setPendingLost(null)}
        onConfirm={async () => {
          if (pendingLost) await moveStage(pendingLost, 'lost')
          setPendingLost(null)
        }}
        title="Mark this lead as Lost?"
        description={
          pendingLost
            ? `"${leadTitle(pendingLost)}" moves to Lost. You can move it back to any stage later — nothing is deleted.`
            : ''
        }
        confirmLabel="Mark as Lost"
        tone="danger"
      />
    </div>
  )
}

/* ============================================================
 * Board view — one column per stage, Ian's exact stage names.
 * Cards drag between columns (dnd-kit); columns are droppables.
 * ============================================================ */

function LeadBoard({
  rows,
  onMove,
  groupByLocation,
}: {
  rows: LeadListRow[]
  onMove: (lead: LeadListRow, target: LeadStage) => void
  groupByLocation: boolean
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {LEAD_STAGE_ORDER.map((stage) => (
          <BoardColumn
            key={stage}
            stage={stage}
            rows={rows}
            onMove={onMove}
            groupByLocation={groupByLocation}
          />
        ))}
      </div>
    </div>
  )
}

function BoardColumn({
  stage,
  rows,
  onMove,
  groupByLocation,
}: {
  stage: LeadStage
  rows: LeadListRow[]
  onMove: (lead: LeadListRow, target: LeadStage) => void
  groupByLocation: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const cards = rows.filter((r) => r.stage === stage)
  const total = cards.reduce((s, c) => s + (Number(c.est_value) || 0), 0)

  // The dashboard splits Proposed + Signed by territory. Grouping OFF:
  // a per-location rollup in these columns' headers. Grouping ON: every
  // column renders literal location sections instead (no double display).
  const regionTotals =
    !groupByLocation && (stage === 'proposed' || stage === 'signed')
      ? LEAD_REGION_ORDER.map((r) => ({
          region: r,
          sum: cards
            .filter((c) => c.region === r)
            .reduce((s, c) => s + (Number(c.est_value) || 0), 0),
        })).filter((x) => x.sum > 0)
      : []
  const groups = groupByLocation ? locationBuckets(cards) : null

  return (
    <div
      ref={setNodeRef}
      data-stage={stage}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-xl border bg-brand-surface transition-colors',
        isOver ? 'border-brand-navy ring-2 ring-brand-navy/30' : 'border-brand-border'
      )}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge kind="lead" value={stage} />
          <span className="text-xs font-semibold text-brand-text-muted">{cards.length}</span>
        </div>
        {total > 0 && (
          <div className="mt-1.5 text-sm font-bold text-brand-text">{formatMoney(total)}</div>
        )}
        {regionTotals.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {regionTotals.map((x) => (
              <div key={x.region} className="flex items-center justify-between text-[11px] text-brand-text-muted">
                <span>{LEAD_REGION_CONFIG[x.region].label}</span>
                <span className="font-semibold">{formatMoney(x.sum)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {cards.length === 0 && (
          <div className="rounded-lg border border-dashed border-brand-border px-3 py-4 text-center text-xs text-brand-text-muted">
            {isOver ? 'Drop here' : 'Empty'}
          </div>
        )}
        {groups
          ? groups.map((g) => (
              <div key={g.key} className="space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-brand-border/70 px-1 pb-1 pt-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">
                    {g.label}
                  </span>
                  <span className="text-[11px] font-semibold text-brand-text">
                    {g.total > 0 ? formatMoney(g.total) : g.cards.length}
                  </span>
                </div>
                {g.cards.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onMove={onMove} />
                ))}
              </div>
            ))
          : cards.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onMove={onMove} />
            ))}
      </div>
    </div>
  )
}

/**
 * Location sections in sheet order: the three canonical territories,
 * then any custom location values (alpha), then location-less rows.
 */
function locationBuckets(cards: LeadListRow[]): Array<{
  key: string
  label: string
  cards: LeadListRow[]
  total: number
}> {
  const canonical: string[] = [...LEAD_REGION_ORDER]
  const custom = [
    ...new Set(
      cards
        .map((c) => c.region)
        .filter((r): r is string => !!r && !canonical.includes(r))
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
        total: bucket.reduce((s, c) => s + (Number(c.est_value) || 0), 0),
      }
    })
    .filter((g) => g.cards.length > 0)
}

function LeadCard({
  lead,
  onMove,
}: {
  lead: LeadListRow
  onMove: (lead: LeadListRow, target: LeadStage) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  })
  const overdue = isOverdue(lead.follow_up_date)
  const region = lead.region
    ? (LEAD_REGION_CONFIG[lead.region] ?? { ...LEAD_REGION_FALLBACK, label: lead.region })
    : null
  const value = Number(lead.est_value) || 0

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cn(
        'cursor-grab touch-none rounded-lg border border-brand-border bg-white p-3 shadow-sm',
        isDragging && 'z-10 opacity-90 shadow-lg ring-2 ring-brand-navy/40'
      )}
    >
      {/* Sheet-order fields (dashboard fidelity): Project Name - Address -
          Description - Date - Location - Source - Value */}
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text-muted/50" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/app/leads/${lead.id}`}
            className="block text-sm font-semibold text-brand-text hover:text-brand-navy hover:underline"
          >
            {leadTitle(lead)}
          </Link>
          {(lead.job_address || lead.town) && (
            <div className="truncate text-xs text-brand-text-muted">
              {[lead.job_address, lead.town].filter(Boolean).join(', ')}
            </div>
          )}
          {lead.description && (
            <div className="truncate text-xs text-brand-text-muted">{lead.description}</div>
          )}
          <div className="truncate text-[11px] text-brand-text-muted/80">
            {formatShortDate(lead.created_at)}
            {lead.source ? ` · ${lead.source}` : ''}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {region && (
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
              region.className
            )}
          >
            {region.label}
          </span>
        )}
        {value > 0 && (
          <span className="text-xs font-bold text-brand-text">{formatMoney(value)}</span>
        )}
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-brand-text-muted">
        {lead.name && <div className="truncate">{lead.name}</div>}
        {lead.project && (
          <div className="flex items-center gap-1">
            <ClipboardList className="h-3 w-3" />
            <Link
              to={`/app/projects/${lead.project.id}`}
              className="truncate hover:text-brand-navy hover:underline"
            >
              {lead.project.name}
            </Link>
          </div>
        )}
        {lead.proposal_count > 0 && (
          <div>
            {lead.proposal_count} proposal{lead.proposal_count === 1 ? '' : 's'}
          </div>
        )}
      </div>
      {lead.follow_up_date && (
        <div
          className={cn(
            'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
            overdue
              ? 'bg-rose-100 text-rose-800 ring-rose-200'
              : 'bg-sky-50 text-sky-800 ring-sky-200'
          )}
        >
          <CalendarClock className="h-3 w-3" />
          {formatShortDate(lead.follow_up_date)}
        </div>
      )}
      <StageSelect lead={lead} onMove={onMove} className="mt-2" />
    </div>
  )
}

/* ============================================================
 * List view — table rows on desktop, stacked cards on mobile.
 * ============================================================ */

function LeadList({
  rows,
  onMove,
  groupByLocation,
}: {
  rows: LeadListRow[]
  onMove: (lead: LeadListRow, target: LeadStage) => void
  groupByLocation: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-brand-border bg-white p-10 text-center text-sm text-brand-text-muted">
        No leads match the current filter.
      </div>
    )
  }
  // Grouping ON: the sheet's literal sections — a location band with
  // count + subtotal, then that location's rows.
  const sections = groupByLocation
    ? locationBuckets(rows)
    : [{ key: '__all__', label: '', cards: rows, total: 0 }]
  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
      {/* Header row — desktop only. Column order mirrors the dashboard
          sheet: Project Name - Address - Description - Date - Location -
          Source - Value (then app columns: Stage / Move to). */}
      <div className="hidden min-w-[1180px] grid-cols-[minmax(160px,1.2fr)_minmax(140px,1fr)_minmax(120px,1fr)_88px_105px_minmax(0,110px)_95px_120px_140px] gap-4 border-b border-brand-border bg-brand-surface px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-text-muted lg:grid">
        <div>Project Name</div>
        <div>Address</div>
        <div>Description</div>
        <div>Date</div>
        <div>Location</div>
        <div>Source</div>
        <div>Value</div>
        <div>Stage</div>
        <div>Move to</div>
      </div>

      <ul className="min-w-[1180px] divide-y divide-brand-border lg:min-w-0">
        {sections.map((section) => (
          <SectionRows
            key={section.key}
            section={section}
            showHeader={groupByLocation}
            onMove={onMove}
          />
        ))}
      </ul>
    </div>
  )
}

function SectionRows({
  section,
  showHeader,
  onMove,
}: {
  section: { key: string; label: string; cards: LeadListRow[]; total: number }
  showHeader: boolean
  onMove: (lead: LeadListRow, target: LeadStage) => void
}) {
  return (
    <>
      {showHeader && (
        <li className="flex items-center justify-between gap-3 bg-brand-surface px-5 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-text">
            {section.label}
          </span>
          <span className="text-xs font-semibold text-brand-text-muted">
            {section.cards.length} {section.cards.length === 1 ? 'row' : 'rows'}
            {section.total > 0 && (
              <>
                {' · '}
                <span className="font-bold text-brand-text">{formatMoney(section.total)}</span>
              </>
            )}
          </span>
        </li>
      )}
      {section.cards.map((lead) => {
          const overdue = isOverdue(lead.follow_up_date)
          const region = lead.region
            ? (LEAD_REGION_CONFIG[lead.region] ?? { ...LEAD_REGION_FALLBACK, label: lead.region })
            : null
          const value = Number(lead.est_value) || 0
          return (
            <li key={lead.id}>
              {/* Desktop layout — sheet column order */}
              <div className="hidden min-w-[1180px] grid-cols-[minmax(160px,1.2fr)_minmax(140px,1fr)_minmax(120px,1fr)_88px_105px_minmax(0,110px)_95px_120px_140px] items-center gap-4 px-5 py-4 lg:grid">
                <div className="min-w-0">
                  <Link
                    to={`/app/leads/${lead.id}`}
                    className="block truncate text-sm font-semibold text-brand-text hover:text-brand-navy hover:underline"
                  >
                    {leadTitle(lead)}
                  </Link>
                  <div className="truncate text-xs text-brand-text-muted">
                    {[
                      lead.name,
                      overdue && lead.follow_up_date
                        ? `follow-up ${formatShortDate(lead.follow_up_date)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                    {lead.proposal_count > 0 && ` · ${lead.proposal_count} proposal${lead.proposal_count === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div className="truncate text-sm text-brand-text-muted">
                  {[lead.job_address, lead.town].filter(Boolean).join(', ') || '—'}
                </div>
                <div className="truncate text-sm text-brand-text-muted">{lead.description ?? '—'}</div>
                <div className="text-sm text-brand-text-muted">{formatShortDate(lead.created_at)}</div>
                <div>
                  {region ? (
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                        region.className
                      )}
                    >
                      {region.label}
                    </span>
                  ) : (
                    <span className="text-sm text-brand-text-muted">—</span>
                  )}
                </div>
                <div className="truncate text-sm text-brand-text-muted">{lead.source ?? '—'}</div>
                <div className="text-sm font-semibold text-brand-text">
                  {value > 0 ? formatMoney(value) : '—'}
                </div>
                <div>
                  <StatusBadge kind="lead" value={lead.stage} />
                </div>
                <div>
                  <StageSelect lead={lead} onMove={onMove} />
                </div>
              </div>

              {/* Mobile layout */}
              <div className="flex flex-col gap-2 px-4 py-4 lg:hidden">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/app/leads/${lead.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-text"
                  >
                    {leadTitle(lead)}
                  </Link>
                  <StatusBadge kind="lead" value={lead.stage} className="shrink-0" />
                </div>
                <div className="flex items-center justify-between text-xs text-brand-text-muted">
                  <span>
                    {[region?.label, value > 0 ? formatMoney(value) : null, lead.town]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </span>
                  {lead.follow_up_date && (
                    <span className={cn(overdue && 'font-semibold text-rose-700')}>
                      Follow up {formatShortDate(lead.follow_up_date)}
                    </span>
                  )}
                </div>
                <StageSelect lead={lead} onMove={onMove} />
              </div>
            </li>
          )
        })}
    </>
  )
}

/* ---------- shared bits ---------- */

/**
 * Compact stage mover. Renders the full stage list (Lost included —
 * reachable from any stage); the page-level handler confirms Lost
 * before writing and routes unconverted→Estimating through Convert.
 */
function StageSelect({
  lead,
  onMove,
  className,
}: {
  lead: LeadListRow
  onMove: (lead: LeadListRow, target: LeadStage) => void
  className?: string
}) {
  return (
    <select
      value={lead.stage}
      onChange={(e) => onMove(lead, e.target.value as LeadStage)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'w-full rounded-md border border-brand-border bg-white px-2 py-1.5 text-xs font-medium text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20',
        className
      )}
    >
      {LEAD_STAGE_ORDER.map((s) => (
        <option key={s} value={s}>
          {LEAD_STAGE_CONFIG[s].label}
        </option>
      ))}
    </select>
  )
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold transition-colors',
        active ? 'bg-brand-navy text-white' : 'bg-white text-brand-text-muted hover:text-brand-text'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const dateInputClasses =
  'rounded-md border border-brand-border bg-white px-2 py-2 text-sm text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

/** Whole-dollar pipeline money — the dashboard shows rollups, not cents. */
function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** Local-date overdue check for the DATE-typed follow_up_date. */
function isOverdue(followUpDate: string | null): boolean {
  if (!followUpDate) return false
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return followUpDate < today
}

function formatShortDate(iso: string): string {
  // DATE columns come back as 'YYYY-MM-DD' — parse as LOCAL date, not
  // UTC, so the displayed day doesn't shift in US timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
