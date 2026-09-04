// Gate review cards (J3) — the two approval steps of THE JAMIE LOOP.
//
// Gate 1 reviews the work areas Jamie proposed (Pass 1); Gate 2 reviews the
// priced takeoff she built for them (Pass 2). Nothing here writes to the
// database — both components hand a decision list up to JamieChatPanel,
// which commits through jamieLoop.ts under the contractor's own RLS.
//
// Everything defaults to APPROVED. Jamie has already done the work; the
// contractor is looking for the one line that's wrong, not ticking twenty
// boxes to accept work they asked for.

import { useMemo, useState } from 'react'
import { Check, Loader2, Plus, Undo2, X } from 'lucide-react'
import type {
  AddedLine,
  JamieLineCategory,
  JamieProposedLine,
  JamieProposedWorkArea,
  LineDecision,
  WorkAreaDecision,
} from '@/lib/jamieLoop'
import {
  categoryBearsMarkup,
  formatUSD,
  liveMarkupPercent,
  type LiveMarkupSettings,
} from '@/lib/money'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────────
// Gate 1 — work areas
// ──────────────────────────────────────────────────────────────────────

/** A work area the contractor typed onto the Gate 1 card themselves. */
export interface AddedWorkArea {
  name: string
  description: string
}

export function WorkAreaGate({
  items,
  existingNameById,
  busy,
  onCommit,
}: {
  items: JamieProposedWorkArea[]
  /** id → name for the contractor's own work areas, for the overlap flag. */
  existingNameById: Record<string, string>
  busy: boolean
  /** Jamie's proposals with the contractor's decisions, plus any work areas
   *  the contractor ADDED on the card (Ian's spec: add, edit and delete at
   *  Gate 1, not just approve/reject). */
  onCommit: (decisions: WorkAreaDecision[], added: AddedWorkArea[]) => void
}) {
  const [state, setState] = useState<
    Record<string, { approved: boolean; name: string; description: string }>
  >(() =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        { approved: true, name: i.proposed_name, description: i.proposed_description ?? '' },
      ])
    )
  )
  // Rows the contractor added. Keyed locally; they have no staged id until
  // the workspace stages them at commit.
  const [added, setAdded] = useState<Array<AddedWorkArea & { key: string }>>([])

  const approvedCount =
    items.filter((i) => state[i.id]?.approved).length +
    added.filter((a) => a.name.trim()).length

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-800">
        Review the work areas
      </p>
      <div className="space-y-2">
        {items.map((item) => {
          const s = state[item.id] ?? {
            approved: true,
            name: item.proposed_name,
            description: item.proposed_description ?? '',
          }
          const overlap = item.source_work_area_id
            ? existingNameById[item.source_work_area_id]
            : null
          return (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border bg-white p-2.5 transition-opacity',
                s.approved ? 'border-gray-200' : 'border-gray-200 opacity-50'
              )}
            >
              <div className="flex items-start gap-2">
                <input
                  value={s.name}
                  onChange={(e) =>
                    setState((p) => ({ ...p, [item.id]: { ...s, name: e.target.value } }))
                  }
                  aria-label={`Name for ${item.proposed_name}`}
                  disabled={!s.approved || busy}
                  className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-1 text-sm font-semibold text-gray-900 outline-none transition-colors hover:border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-transparent"
                />
                {/* Labelled, not icon-only: an unlabelled undo arrow read as
                    nothing, and the contractor approved every work area then
                    deleted the extras from the Work Areas tab instead. */}
                <button
                  type="button"
                  onClick={() =>
                    setState((p) => ({ ...p, [item.id]: { ...s, approved: !s.approved } }))
                  }
                  disabled={busy}
                  aria-label={s.approved ? `Skip ${item.proposed_name}` : `Keep ${item.proposed_name}`}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors',
                    s.approved
                      ? 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800'
                      : 'border-brand-gold/40 bg-brand-gold/10 text-brand-gold-dark hover:bg-brand-gold/20'
                  )}
                >
                  {s.approved ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  {s.approved ? 'Skip' : 'Keep'}
                </button>
              </div>
              {/* The scope Jamie proposed — editable, because Pass 2 builds
                  the takeoff FROM this text and the contractor may know a
                  quantity or method she got wrong. */}
              <textarea
                value={s.description}
                onChange={(e) =>
                  setState((p) => ({ ...p, [item.id]: { ...s, description: e.target.value } }))
                }
                disabled={!s.approved || busy}
                rows={4}
                aria-label={`Scope for ${item.proposed_name}`}
                className="mt-1 w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] leading-relaxed text-gray-600 outline-none transition-colors hover:border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-transparent"
              />
              {overlap && (
                <p className="mt-1.5 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                  Looks like your existing &ldquo;{overlap}&rdquo;. Skip this one if
                  it&apos;s the same scope — Jamie won&apos;t touch yours either way.
                </p>
              )}
            </div>
          )
        })}

        {added.map((a, idx) => (
          <div
            key={a.key}
            className="rounded-lg border border-dashed border-brand-gold/50 bg-white p-2.5"
          >
            <div className="flex items-start gap-2">
              <input
                value={a.name}
                autoFocus
                onChange={(e) =>
                  setAdded((p) => p.map((x) => (x.key === a.key ? { ...x, name: e.target.value } : x)))
                }
                placeholder={`Work area ${items.length + idx + 1} — e.g. "Mobilization & Travel"`}
                aria-label="Name for the work area you are adding"
                disabled={busy}
                className="min-w-0 flex-1 rounded-md border border-gray-200 px-1.5 py-1 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setAdded((p) => p.filter((x) => x.key !== a.key))}
                disabled={busy}
                aria-label="Remove this added work area"
                className="flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
            <textarea
              value={a.description}
              onChange={(e) =>
                setAdded((p) =>
                  p.map((x) => (x.key === a.key ? { ...x, description: e.target.value } : x))
                )
              }
              disabled={busy}
              rows={3}
              placeholder="What's in it, with quantities if you have them. Leave blank and Jamie scopes it from the name and the conversation."
              aria-label="Scope for the work area you are adding"
              className="mt-1 w-full resize-y rounded-md border border-gray-200 px-1.5 py-1 text-[12px] leading-relaxed text-gray-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Yours — Jamie prices it in the takeoff with the rest.
            </p>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setAdded((p) => [...p, { key: crypto.randomUUID(), name: '', description: '' }])
          }
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-[12px] font-semibold text-gray-600 transition-colors hover:border-brand-gold/60 hover:bg-brand-gold/5 hover:text-brand-gold-dark disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a work area Jamie missed
        </button>
      </div>
      <button
        type="button"
        disabled={busy || approvedCount === 0}
        onClick={() =>
          onCommit(
            items.map((i) => {
              const s = state[i.id] ?? {
                approved: true,
                name: i.proposed_name,
                description: i.proposed_description ?? '',
              }
              return {
                id: i.id,
                approved: s.approved,
                name: s.name,
                description: s.description.trim() || null,
              }
            }),
            added
              .filter((a) => a.name.trim())
              .map((a) => ({ name: a.name.trim(), description: a.description.trim() }))
          )
        }
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gold py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {approvedCount === 0
          ? 'Keep at least one'
          : `Add ${approvedCount} work area${approvedCount === 1 ? '' : 's'}`}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-amber-900/80">
        Not the right split? Skip what you don&apos;t want, add what she missed,
        or tell Jamie what to change in the box below and hit{' '}
        <strong>Propose again</strong> — talking alone doesn&apos;t change
        what&apos;s on screen.
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Gate 2 — priced lines
// ──────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  labor: 'Labor',
  material: 'Materials',
  equipment: 'Equipment',
  subcontractor: 'Subcontractor',
  other: 'Other',
}

export function LineGate({
  groups,
  markups,
  busy,
  onCommit,
}: {
  groups: Array<JamieProposedWorkArea & { lines: JamieProposedLine[] }>
  /** The contractor's live My Numbers markups, so this review shows the
   *  BILLED price — not the cost basis dressed up as a price. */
  markups: LiveMarkupSettings
  busy: boolean
  /** Decisions on Jamie's lines, the final scope text per work area, and
   *  the lines the contractor ADDED on the card, keyed by staged work
   *  area id (Ian's spec §6: add / edit / delete line items; change
   *  quantity, cost, markup, price). */
  onCommit: (
    decisions: LineDecision[],
    descriptions: Record<string, string>,
    clientScopes: Record<string, string>,
    added: Record<string, AddedLine[]>
  ) => void
}) {
  const allLines = useMemo(() => groups.flatMap((g) => g.lines), [groups])
  // The scope Pass 2 wrote FROM the takeoff. Editable here — it is what
  // the client reads and what the crew works from, so the contractor gets
  // the last word on the wording.
  const [scopes, setScopes] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.proposed_description ?? '']))
  )
  // The CLIENT scope (JAMIE-FLOW 4a) — the only scope text that reaches the
  // client. Kept separate from the work order above because one text cannot
  // serve both: the crew needs lift counts and load counts, and a client
  // holding those can demand a redo when the crew builds it a different,
  // equally good way.
  const [clientScopes, setClientScopes] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.proposed_client_description ?? '']))
  )
  // Local string state per editable cell — parse on commit, not per
  // keystroke, so "0." and "5.2" survive typing (session-discipline 1A/A).
  // markup: '' = follow My Numbers; price: '' = computed. Both mirror the
  // estimate editor's per-line overrides.
  const [state, setState] = useState<
    Record<string, { approved: boolean; qty: string; cost: string; markup: string; price: string }>
  >(() =>
    Object.fromEntries(
      allLines.map((l) => [
        l.id,
        {
          approved: true,
          qty: l.quantity === null ? '' : String(l.quantity),
          cost: l.unit_cost === null ? '' : String(l.unit_cost),
          markup: '',
          price: '',
        },
      ])
    )
  )
  // Lines the contractor typed under a work area. No staged id until the
  // workspace stages them at commit.
  type AddedRow = {
    key: string
    category: JamieLineCategory
    label: string
    unit: string
    qty: string
    cost: string
    markup: string
    price: string
  }
  const [added, setAdded] = useState<Record<string, AddedRow[]>>({})
  const patchAdded = (pwaId: string, key: string, patch: Partial<AddedRow>) =>
    setAdded((p) => ({
      ...p,
      [pwaId]: (p[pwaId] ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }))

  const num = (s: string) => {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }
  /** Billed price for a set of cells at the contractor's markup rules:
   *  a typed price wins; else qty × cost × (1 + markup), where markup is
   *  the per-line override when typed, else My Numbers for the category. */
  const billedFor = (
    category: JamieLineCategory,
    cells: { qty: string; cost: string; markup: string; price: string }
  ) => {
    const p = num(cells.price)
    if (p !== null) return p
    const q = num(cells.qty)
    const c = num(cells.cost)
    if (q === null || c === null) return 0
    return q * c * (1 + markupFor(category, cells.markup) / 100)
  }
  const markupFor = (category: JamieLineCategory, typed: string) => {
    if (!categoryBearsMarkup(category)) return 0
    const m = num(typed)
    return m !== null ? m : liveMarkupPercent(category, markups)
  }
  const billedOf = (l: JamieProposedLine) => {
    const st = state[l.id]
    if (!st?.approved) return 0
    return billedFor(l.category, st)
  }
  const addedRows = (pwaId: string) => added[pwaId] ?? []
  const addedIsComplete = (r: AddedRow) =>
    r.label.trim() !== '' && (num(r.qty) ?? 0) > 0 && (num(r.cost) ?? 0) > 0
  const allAdded = Object.values(added).flat()
  const incompleteAdded = allAdded.filter((r) => !addedIsComplete(r)).length

  const approved = allLines.filter((l) => state[l.id]?.approved)
  const groupTotal = (g: JamieProposedWorkArea & { lines: JamieProposedLine[] }) =>
    g.lines.reduce((a, l) => a + billedOf(l), 0) +
    addedRows(g.id).reduce((a, r) => a + (addedIsComplete(r) ? billedFor(r.category, r) : 0), 0)
  const grandTotal = groups.reduce((a, g) => a + groupTotal(g), 0)
  // Jamie's own figures, flagged for confirmation. NOT zeros — a $0 line
  // is an unfinished estimate and the schema no longer permits one.
  const toConfirm = approved.filter((l) => l.needs_pricing).length
  const stillBlank = approved.filter((l) => {
    const raw = state[l.id]?.cost ?? ''
    return raw.trim() === '' || parseFloat(raw) === 0
  }).length
  const commitCount = approved.length + allAdded.filter(addedIsComplete).length

  const cellCls =
    'rounded border border-gray-200 px-1.5 py-0.5 text-right text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-800">
        Review the takeoff
      </p>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">{g.proposed_name}</p>
              <span className="shrink-0 text-[12px] font-semibold text-gray-500">
                {formatUSD(groupTotal(g))}
              </span>
            </div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Client scope · goes on the proposal
            </p>
            <textarea
              value={clientScopes[g.id] ?? ''}
              onChange={(e) => setClientScopes((p) => ({ ...p, [g.id]: e.target.value }))}
              disabled={busy}
              rows={4}
              aria-label={`Client scope for ${g.proposed_name}`}
              placeholder="What the client is buying. Headline sizes only — no costs, no fees, no lift or load counts."
              className="mb-2 w-full resize-y rounded-md border border-emerald-200 bg-emerald-50/40 px-2 py-1.5 text-[12px] leading-relaxed text-gray-700 outline-none transition-colors focus:border-emerald-500 focus:bg-white focus:ring-1 focus:ring-emerald-500"
            />
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Work order · crew + your copy, never sent to the client
            </p>
            <textarea
              value={scopes[g.id] ?? ''}
              onChange={(e) => setScopes((p) => ({ ...p, [g.id]: e.target.value }))}
              disabled={busy}
              rows={8}
              aria-label={`Work order scope for ${g.proposed_name}`}
              className="mb-2 w-full resize-y rounded-md border border-gray-200 bg-gray-50/60 px-2 py-1.5 text-[12px] leading-relaxed text-gray-700 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
            <div className="space-y-1">
              {g.lines.map((l) => {
                const s = state[l.id] ?? { approved: true, qty: '', cost: '', markup: '', price: '' }
                const base = (num(s.qty) ?? 0) * (num(s.cost) ?? 0)
                const bears = categoryBearsMarkup(l.category)
                // KYN: material/sub/other carry the contractor's markup;
                // labor and equipment are already fully burdened at their
                // retail rate. unit_cost here is the COST — showing base as
                // the line price would understate every material line.
                const mk = markupFor(l.category, s.markup)
                const computed = base * (1 + mk / 100)
                const priceOverridden = num(s.price) !== null
                const total = billedFor(l.category, s)
                return (
                  <div
                    key={l.id}
                    className={cn(
                      'rounded-md px-1.5 py-1 transition-opacity',
                      s.approved ? '' : 'opacity-45'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setState((p) => ({ ...p, [l.id]: { ...s, approved: !s.approved } }))
                        }
                        disabled={busy}
                        aria-label={s.approved ? `Skip ${l.label}` : `Keep ${l.label}`}
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          s.approved
                            ? 'border-brand-gold bg-brand-gold text-white'
                            : 'border-gray-300 bg-white'
                        )}
                      >
                        {s.approved && <Check className="h-3 w-3" />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800">
                        {l.label}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
                        {CATEGORY_LABEL[l.category] ?? l.category}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-5.5">
                      <input
                        value={s.qty}
                        onChange={(e) =>
                          setState((p) => ({ ...p, [l.id]: { ...s, qty: e.target.value } }))
                        }
                        inputMode="decimal"
                        disabled={!s.approved || busy}
                        aria-label={`Quantity for ${l.label}`}
                        className={cn('w-16', cellCls)}
                      />
                      <span className="text-[11px] text-gray-400">{l.unit || 'EA'} ×</span>
                      <input
                        value={s.cost}
                        onChange={(e) =>
                          setState((p) => ({ ...p, [l.id]: { ...s, cost: e.target.value } }))
                        }
                        inputMode="decimal"
                        disabled={!s.approved || busy}
                        aria-label={`Unit cost for ${l.label}`}
                        className={cn(
                          'w-20',
                          cellCls,
                          l.needs_pricing && (s.cost.trim() === '' || parseFloat(s.cost) === 0)
                            ? 'border-rose-300 bg-rose-50'
                            : ''
                        )}
                      />
                      {/* Markup — per line, like the estimate editor. Blank
                          follows My Numbers; a number pins this line. */}
                      {bears && (
                        <>
                          <span className="text-[11px] text-gray-400">+</span>
                          <input
                            value={s.markup}
                            onChange={(e) =>
                              setState((p) => ({ ...p, [l.id]: { ...s, markup: e.target.value } }))
                            }
                            inputMode="decimal"
                            disabled={!s.approved || busy}
                            placeholder={String(liveMarkupPercent(l.category, markups))}
                            aria-label={`Markup percent for ${l.label} (blank follows My Numbers)`}
                            title="Markup % for this line — blank follows your My Numbers markup"
                            className={cn(
                              'w-12',
                              cellCls,
                              num(s.markup) !== null ? 'border-amber-300 bg-amber-50' : ''
                            )}
                          />
                          <span className="text-[11px] text-gray-400">%</span>
                        </>
                      )}
                      {/* Price — the billed total. Typing sets an override
                          (amber); blank means computed. */}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <input
                          value={s.price}
                          onChange={(e) =>
                            setState((p) => ({ ...p, [l.id]: { ...s, price: e.target.value } }))
                          }
                          inputMode="decimal"
                          disabled={!s.approved || busy}
                          placeholder={formatUSD(computed)}
                          aria-label={`Billed price for ${l.label} (blank is computed)`}
                          title="Billed price — type to override the computed price"
                          className={cn(
                            'w-24 font-semibold',
                            cellCls,
                            priceOverridden ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-gray-700'
                          )}
                        />
                        {priceOverridden && (
                          <button
                            type="button"
                            onClick={() =>
                              setState((p) => ({ ...p, [l.id]: { ...s, price: '' } }))
                            }
                            disabled={busy}
                            aria-label={`Clear price override for ${l.label}`}
                            title="Back to the computed price"
                            className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="pl-5.5 text-[11px] leading-snug text-gray-400">
                      {mk > 0 && !priceOverridden && (
                        <span>
                          {formatUSD(base)} cost + {mk}%{num(s.markup) !== null ? ' (custom)' : ''} ={' '}
                          {formatUSD(total)}.{' '}
                        </span>
                      )}
                      {priceOverridden && (
                        <span className="text-amber-700">
                          Overridden to {formatUSD(total)} (computed {formatUSD(computed)}).{' '}
                        </span>
                      )}
                      {l.reasoning}
                    </p>
                  </div>
                )
              })}

              {addedRows(g.id).map((r) => {
                const complete = addedIsComplete(r)
                const bears = categoryBearsMarkup(r.category)
                return (
                  <div
                    key={r.key}
                    className="rounded-md border border-dashed border-brand-gold/50 px-1.5 py-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <select
                        value={r.category}
                        onChange={(e) =>
                          patchAdded(g.id, r.key, { category: e.target.value as JamieLineCategory })
                        }
                        disabled={busy}
                        aria-label="Category for the line you are adding"
                        className="rounded border border-gray-200 px-1 py-0.5 text-[11px] uppercase tracking-wide text-gray-600 outline-none focus:border-blue-500"
                      >
                        {(Object.keys(CATEGORY_LABEL) as JamieLineCategory[]).map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                      <input
                        value={r.label}
                        autoFocus
                        onChange={(e) => patchAdded(g.id, r.key, { label: e.target.value })}
                        disabled={busy}
                        placeholder="Item name, the way your supplier calls it"
                        aria-label="Name for the line you are adding"
                        className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-0.5 text-[12px] text-gray-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAdded((p) => ({
                            ...p,
                            [g.id]: (p[g.id] ?? []).filter((x) => x.key !== r.key),
                          }))
                        }
                        disabled={busy}
                        aria-label="Remove this added line"
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-5.5">
                      <input
                        value={r.qty}
                        onChange={(e) => patchAdded(g.id, r.key, { qty: e.target.value })}
                        inputMode="decimal"
                        disabled={busy}
                        placeholder="qty"
                        aria-label="Quantity for the line you are adding"
                        className={cn('w-16', cellCls)}
                      />
                      <input
                        value={r.unit}
                        onChange={(e) => patchAdded(g.id, r.key, { unit: e.target.value })}
                        disabled={busy}
                        placeholder="EA"
                        aria-label="Unit for the line you are adding"
                        className="w-12 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] uppercase outline-none focus:border-blue-500"
                      />
                      <span className="text-[11px] text-gray-400">×</span>
                      <input
                        value={r.cost}
                        onChange={(e) => patchAdded(g.id, r.key, { cost: e.target.value })}
                        inputMode="decimal"
                        disabled={busy}
                        placeholder={bears ? 'base cost' : '$/hr'}
                        aria-label="Unit cost for the line you are adding"
                        className={cn('w-20', cellCls)}
                      />
                      {bears && (
                        <>
                          <span className="text-[11px] text-gray-400">+</span>
                          <input
                            value={r.markup}
                            onChange={(e) => patchAdded(g.id, r.key, { markup: e.target.value })}
                            inputMode="decimal"
                            disabled={busy}
                            placeholder={String(liveMarkupPercent(r.category, markups))}
                            aria-label="Markup percent for the line you are adding (blank follows My Numbers)"
                            className={cn('w-12', cellCls, num(r.markup) !== null ? 'border-amber-300 bg-amber-50' : '')}
                          />
                          <span className="text-[11px] text-gray-400">%</span>
                        </>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <input
                          value={r.price}
                          onChange={(e) => patchAdded(g.id, r.key, { price: e.target.value })}
                          inputMode="decimal"
                          disabled={busy}
                          placeholder={complete ? formatUSD(billedFor(r.category, { ...r, price: '' })) : '$'}
                          aria-label="Billed price for the line you are adding (blank is computed)"
                          className={cn(
                            'w-24 font-semibold',
                            cellCls,
                            num(r.price) !== null ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-gray-700'
                          )}
                        />
                      </span>
                    </div>
                    <p className="pl-5.5 text-[11px] text-gray-400">
                      {complete
                        ? 'Yours — priced with the rest and saved to your catalog on approve.'
                        : 'Needs a name, a quantity and a cost.'}
                    </p>
                  </div>
                )
              })}

              <button
                type="button"
                onClick={() =>
                  setAdded((p) => ({
                    ...p,
                    [g.id]: [
                      ...(p[g.id] ?? []),
                      {
                        key: crypto.randomUUID(),
                        category: 'material',
                        label: '',
                        unit: 'EA',
                        qty: '',
                        cost: '',
                        markup: '',
                        price: '',
                      },
                    ],
                  }))
                }
                disabled={busy}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-brand-gold/60 hover:bg-brand-gold/5 hover:text-brand-gold-dark disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Add a line Jamie missed
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between rounded-md bg-white px-2.5 py-2">
        <span className="text-[12px] font-bold text-gray-900">Estimate total</span>
        <span className="text-sm font-bold text-gray-900">{formatUSD(grandTotal)}</span>
      </div>
      {toConfirm > 0 && (
        <p className="mt-1.5 rounded-md bg-amber-100/70 px-2 py-1.5 text-[11px] text-amber-900">
          {toConfirm} line{toConfirm === 1 ? ' uses' : 's use'} Jamie&apos;s own price
          rather than one from your catalog. Worth a look — change anything that
          isn&apos;t what you actually pay, or tell Jamie the price in the chat.
        </p>
      )}
      {stillBlank > 0 && (
        <p className="mt-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
          {stillBlank} line{stillBlank === 1 ? ' has' : 's have'} no cost. That
          under-bids the job — put a real number in before adding it.
        </p>
      )}
      <button
        type="button"
        // A zero-cost line under-bids the job, so it cannot be committed.
        // KYN is enforced here because structured output has no numeric
        // bounds — see the schema note in jamie-chat.
        disabled={busy || commitCount === 0 || stillBlank > 0 || incompleteAdded > 0}
        onClick={() =>
          onCommit(
            allLines.map((l) => {
              const s = state[l.id] ?? { approved: true, qty: '', cost: '', markup: '', price: '' }
              return {
                id: l.id,
                approved: s.approved,
                quantity: num(s.qty) ?? 0,
                unitCost: num(s.cost) ?? 0,
                markupOverride: categoryBearsMarkup(l.category) ? num(s.markup) : null,
                priceOverride: num(s.price),
              }
            }),
            scopes,
            clientScopes,
            Object.fromEntries(
              Object.entries(added).map(([pwaId, rows]) => [
                pwaId,
                rows.filter(addedIsComplete).map((r) => ({
                  category: r.category,
                  label: r.label.trim(),
                  unit: r.unit.trim() || 'EA',
                  quantity: num(r.qty) ?? 0,
                  unitCost: num(r.cost) ?? 0,
                  markupOverride: categoryBearsMarkup(r.category) ? num(r.markup) : null,
                  priceOverride: num(r.price),
                })),
              ])
            )
          )
        }
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gold py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {commitCount === 0
          ? 'Keep at least one'
          : incompleteAdded > 0
            ? `Finish the line${incompleteAdded === 1 ? '' : 's'} you added`
            : stillBlank > 0
              ? `Price ${stillBlank} line${stillBlank === 1 ? '' : 's'} first`
              : `Add ${commitCount} line${commitCount === 1 ? '' : 's'} · ${formatUSD(grandTotal)}`}
      </button>
    </div>
  )
}
