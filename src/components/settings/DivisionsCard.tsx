import { useState } from 'react'
import { Layers, Loader2, Plus, Trash2 } from 'lucide-react'
import type { CompanyDivision } from '@/lib/types'

/**
 * Divisions — optional groupings for My Numbers.
 *
 * A contractor's hardscape crew and their planting crew do not cost the
 * same money, and KYN has always modelled that. This is where those groups
 * are created; the labor and equipment cards below then sort themselves
 * into them.
 *
 * OPT-IN. With no divisions the rest of the page renders exactly the flat
 * list it always has, so a one-crew outfit never has to think about this.
 * Which is why the card leads with what it's for rather than a bare list.
 *
 * Deleting a division never deletes rates — division_id is ON DELETE SET
 * NULL, so they fall back to Ungrouped, still visible and still wired to
 * any kit that used them.
 */
type DivisionPatch = Partial<
  Pick<CompanyDivision, 'name' | 'markup_materials_percent' | 'markup_subs_percent'>
>

export function DivisionsCard({
  divisions,
  companyMarkups,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: {
  divisions: readonly CompanyDivision[]
  /** The company-wide markups — shown as the inherited value on a blank field. */
  companyMarkups: { materials: number | null; subs: number | null }
  busy: boolean
  onCreate: (name: string) => void | Promise<void>
  onUpdate: (id: string, patch: DivisionPatch) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const name = draft.trim()
    if (name === '') return
    setDraft('')
    void onCreate(name)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-6 py-4">
        <Layers className="h-5 w-5 text-slate-600" />
        <div>
          <h2 className="font-semibold text-gray-900">Divisions</h2>
          <p className="text-xs text-gray-500">
            Optional. Keep separate rate sets for the different kinds of work
            you do — the labor and equipment below sort into whichever you
            create.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-6">
        {divisions.length === 0 && (
          <p className="text-sm text-gray-500">
            No divisions yet, so your rates are one flat list. That's the right
            setup for most contractors — add one only if you price different
            kinds of work off different numbers.
          </p>
        )}

        {divisions.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <input
              type="text"
              defaultValue={d.name}
              disabled={busy}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next !== '' && next !== d.name) void onUpdate(d.id, { name: next })
                else e.target.value = d.name
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-all focus:border-slate-500 focus:ring-2 focus:ring-slate-500 disabled:opacity-60"
            />
            {/* This division's own markups (0040). Blank = inherit the
                company-wide value, which is shown as the placeholder so
                the contractor can see what "blank" currently means. */}
            <MarkupField
              label="Mat"
              value={d.markup_materials_percent}
              inherited={companyMarkups.materials}
              disabled={busy}
              onCommit={(v) => void onUpdate(d.id, { markup_materials_percent: v })}
            />
            <MarkupField
              label="Subs"
              value={d.markup_subs_percent}
              inherited={companyMarkups.subs}
              disabled={busy}
              onCommit={(v) => void onUpdate(d.id, { markup_subs_percent: v })}
            />
            {d.kyn_year !== null && (
              <span
                title={`Imported from your ${d.kyn_year} Know Your Numbers model`}
                className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700"
              >
                KYN {d.kyn_year}
              </span>
            )}
            <button
              type="button"
              onClick={() => void onDelete(d.id)}
              disabled={busy}
              title="Remove this division — its rates move to Ungrouped"
              aria-label={`Remove division ${d.name}`}
              className="rounded-md p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-1">
          <input
            type="text"
            value={draft}
            disabled={busy}
            placeholder="New division — e.g. Hardscape"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            className="flex-1 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm outline-none transition-all focus:border-slate-500 focus:ring-2 focus:ring-slate-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || draft.trim() === ''}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>

        {divisions.length > 0 && (
          <p className="pt-1 text-xs text-gray-400">
            Mat / Subs are this division's own markups; leave one blank to use
            the company-wide value. Removing a division never removes its
            rates — they move to Ungrouped, and any kit built on them keeps
            working.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A percent field whose EMPTY state is meaningful: it means "inherit". The
 * inherited number rides in the placeholder, so blank never reads as zero.
 */
function MarkupField({
  label,
  value,
  inherited,
  disabled,
  onCommit,
}: {
  label: string
  value: number | null
  inherited: number | null
  disabled: boolean
  onCommit: (value: number | null) => void
}) {
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-gray-500">
      {label}
      <input
        type="number"
        min="0"
        step="0.1"
        defaultValue={value ?? ''}
        placeholder={inherited === null ? '—' : String(inherited)}
        disabled={disabled}
        title={
          value === null
            ? `Using the company-wide ${label === 'Mat' ? 'materials' : 'subs'} markup`
            : `${label === 'Mat' ? 'Materials' : 'Subs'} markup for this division`
        }
        onBlur={(e) => {
          const raw = e.target.value.trim()
          const next = raw === '' ? null : Number(raw)
          if (next !== null && !Number.isFinite(next)) {
            e.target.value = value === null ? '' : String(value)
            return
          }
          if (next !== value) onCommit(next)
        }}
        className="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-500 disabled:opacity-60"
      />
      <span className="text-gray-400">%</span>
    </label>
  )
}

export default DivisionsCard
