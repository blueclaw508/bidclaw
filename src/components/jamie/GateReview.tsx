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
import { Check, Loader2, Undo2 } from 'lucide-react'
import type {
  JamieProposedLine,
  JamieProposedWorkArea,
  LineDecision,
  WorkAreaDecision,
} from '@/lib/jamieLoop'
import { formatUSD, liveMarkupPercent, type LiveMarkupSettings } from '@/lib/money'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────────
// Gate 1 — work areas
// ──────────────────────────────────────────────────────────────────────

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
  onCommit: (decisions: WorkAreaDecision[]) => void
}) {
  const [state, setState] = useState<Record<string, { approved: boolean; name: string }>>(
    () =>
      Object.fromEntries(
        items.map((i) => [i.id, { approved: true, name: i.proposed_name }])
      )
  )

  const approvedCount = items.filter((i) => state[i.id]?.approved).length

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-800">
        Review the work areas
      </p>
      <div className="space-y-2">
        {items.map((item) => {
          const s = state[item.id] ?? { approved: true, name: item.proposed_name }
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
                <button
                  type="button"
                  onClick={() =>
                    setState((p) => ({ ...p, [item.id]: { ...s, approved: !s.approved } }))
                  }
                  disabled={busy}
                  aria-label={s.approved ? `Skip ${item.proposed_name}` : `Keep ${item.proposed_name}`}
                  className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  {s.approved ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </button>
              </div>
              {item.proposed_description && (
                <p className="mt-1 whitespace-pre-wrap px-1.5 text-[12px] leading-relaxed text-gray-600">
                  {item.proposed_description}
                </p>
              )}
              {overlap && (
                <p className="mt-1.5 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                  Looks like your existing &ldquo;{overlap}&rdquo;. Skip this one if
                  it&apos;s the same scope — Jamie won&apos;t touch yours either way.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        disabled={busy || approvedCount === 0}
        onClick={() =>
          onCommit(
            items.map((i) => {
              const s = state[i.id] ?? { approved: true, name: i.proposed_name }
              return {
                id: i.id,
                approved: s.approved,
                name: s.name,
                description: i.proposed_description,
              }
            })
          )
        }
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gold py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {approvedCount === 0
          ? 'Keep at least one'
          : `Add ${approvedCount} work area${approvedCount === 1 ? '' : 's'}`}
      </button>
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
  onCommit: (decisions: LineDecision[]) => void
}) {
  const allLines = useMemo(() => groups.flatMap((g) => g.lines), [groups])
  // Local string state per editable cell — parse on commit, not per
  // keystroke, so "0." and "5.2" survive typing (session-discipline 1A/A).
  const [state, setState] = useState<
    Record<string, { approved: boolean; qty: string; cost: string }>
  >(() =>
    Object.fromEntries(
      allLines.map((l) => [
        l.id,
        {
          approved: true,
          qty: l.quantity === null ? '' : String(l.quantity),
          cost: l.unit_cost === null ? '' : String(l.unit_cost),
        },
      ])
    )
  )

  const approved = allLines.filter((l) => state[l.id]?.approved)
  /** Billed price of one staged line at the contractor's live markup. */
  const billedOf = (l: JamieProposedLine) => {
    const st = state[l.id]
    if (!st?.approved) return 0
    const q = parseFloat(st.qty)
    const c = parseFloat(st.cost)
    if (!Number.isFinite(q) || !Number.isFinite(c)) return 0
    return q * c * (1 + liveMarkupPercent(l.category, markups) / 100)
  }
  const grandTotal = allLines.reduce((a, l) => a + billedOf(l), 0)
  // Jamie's own figures, flagged for confirmation. NOT zeros — a $0 line
  // is an unfinished estimate and the schema no longer permits one.
  const toConfirm = approved.filter((l) => l.needs_pricing).length
  const stillBlank = approved.filter((l) => {
    const raw = state[l.id]?.cost ?? ''
    return raw.trim() === '' || parseFloat(raw) === 0
  }).length

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
                {formatUSD(g.lines.reduce((a, l) => a + billedOf(l), 0))}
              </span>
            </div>
            <div className="space-y-1">
              {g.lines.map((l) => {
                const s = state[l.id] ?? { approved: true, qty: '', cost: '' }
                const qty = parseFloat(s.qty)
                const cost = parseFloat(s.cost)
                const base = Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0
                // KYN: material/sub/other carry the contractor's markup;
                // labor and equipment are already fully burdened at their
                // retail rate. unit_cost here is the COST — showing base as
                // the line price would understate every material line.
                const mk = liveMarkupPercent(l.category, markups)
                const total = base * (1 + mk / 100)
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
                    <div className="mt-0.5 flex items-center gap-1.5 pl-5.5">
                      <input
                        value={s.qty}
                        onChange={(e) =>
                          setState((p) => ({ ...p, [l.id]: { ...s, qty: e.target.value } }))
                        }
                        inputMode="decimal"
                        disabled={!s.approved || busy}
                        aria-label={`Quantity for ${l.label}`}
                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
                          'w-20 rounded border px-1.5 py-0.5 text-right text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                          l.needs_pricing && (s.cost.trim() === '' || parseFloat(s.cost) === 0)
                            ? 'border-rose-300 bg-rose-50'
                            : 'border-gray-200'
                        )}
                      />
                      <span className="ml-auto shrink-0 text-right text-[12px] font-semibold text-gray-700">
                        {formatUSD(total)}
                        {mk > 0 && (
                          <span className="block text-[10px] font-normal text-gray-400">
                            {formatUSD(base)} cost + {mk}%
                          </span>
                        )}
                      </span>
                    </div>
                    {l.reasoning && (
                      <p className="pl-5.5 text-[11px] leading-snug text-gray-400">
                        {l.reasoning}
                      </p>
                    )}
                  </div>
                )
              })}
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
          isn&apos;t what you actually pay.
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
        disabled={busy || approved.length === 0 || stillBlank > 0}
        onClick={() =>
          onCommit(
            allLines.map((l) => {
              const s = state[l.id] ?? { approved: true, qty: '', cost: '' }
              const qty = parseFloat(s.qty)
              const cost = parseFloat(s.cost)
              return {
                id: l.id,
                approved: s.approved,
                quantity: Number.isFinite(qty) ? qty : 0,
                unitCost: Number.isFinite(cost) ? cost : 0,
              }
            })
          )
        }
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gold py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {approved.length === 0
          ? 'Keep at least one'
          : stillBlank > 0
            ? `Price ${stillBlank} line${stillBlank === 1 ? '' : 's'} first`
            : `Add ${approved.length} line${approved.length === 1 ? '' : 's'} · ${formatUSD(grandTotal)}`}
      </button>
    </div>
  )
}
