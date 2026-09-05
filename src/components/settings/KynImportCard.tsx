import { useState } from 'react'
import { Download, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyKynImport,
  loadKynCatalogue,
  previewKynImport,
  KynSyncError,
  type KynDivisionPlan,
  type KynMarkupPlan,
  type KynModelSummary,
} from '@/lib/kynSync'

/**
 * Import My Numbers from Know Your Numbers.
 *
 * Three deliberate steps — find, preview, import — because this writes over
 * numbers the contractor may have typed themselves. Nothing is written until
 * they have seen the exact rate for every crew and machine, by name.
 *
 * Divisions are MULTI-SELECT and each becomes a BidClaw division, so a
 * contractor who runs hardscape and planting off different numbers keeps
 * them apart instead of having them averaged into one set.
 */
export function KynImportCard({ onImported }: { onImported: () => void }) {
  const [catalogue, setCatalogue] = useState<KynModelSummary[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [plans, setPlans] = useState<KynDivisionPlan[] | null>(null)
  const [markupPlan, setMarkupPlan] = useState<KynMarkupPlan | null>(null)
  const [busy, setBusy] = useState<'find' | 'preview' | 'apply' | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)

  const clearPreview = () => {
    setPlans(null)
    setMarkupPlan(null)
  }

  const find = async () => {
    setBusy('find')
    setNotFound(null)
    try {
      const { catalogue: c } = await loadKynCatalogue()
      setCatalogue(c)
      if (c.length > 0) {
        setYear(c[0].year)
        setPicked([])
        clearPreview()
      }
    } catch (err) {
      if (
        err instanceof KynSyncError &&
        (err.code === 'NO_KYN_ACCOUNT' || err.code === 'NO_MODEL')
      ) {
        setNotFound(err.message)
      } else {
        toast.error(
          err instanceof Error ? err.message : "Couldn't reach Know Your Numbers."
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const toggle = (index: number) => {
    clearPreview()
    setPicked((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    )
  }

  const preview = async () => {
    if (year === null || picked.length === 0) return
    setBusy('preview')
    try {
      const res = await previewKynImport(year, picked)
      setPlans(res.plans)
      setMarkupPlan(res.markupPlan)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read those divisions.")
      clearPreview()
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (year === null || picked.length === 0) return
    setBusy('apply')
    try {
      await applyKynImport(year, picked)
      toast.success(
        picked.length === 1
          ? 'Your Know Your Numbers rates are in.'
          : `Imported ${picked.length} divisions from Know Your Numbers.`
      )
      clearPreview()
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish the import.")
    } finally {
      setBusy(null)
    }
  }

  const model = catalogue?.find((m) => m.year === year) ?? null

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-6 py-4">
        <Download className="h-5 w-5 text-emerald-600" />
        <div>
          <h2 className="font-semibold text-gray-900">
            Import from Know Your Numbers
          </h2>
          <p className="text-xs text-gray-500">
            Pull your crew rates, equipment rates and markups straight out of
            KYN instead of retyping them.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {/* The scope note. BidClaw prices construction work; recurring
            maintenance routes are RouteClaw's job, and a contractor whose
            KYN model carries both should know which half belongs here. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">
              BidClaw is built for construction divisions.
            </span>{' '}
            Import the divisions you bid and build work out of. Recurring
            maintenance belongs in RouteClaw, so a maintenance division's
            numbers aren't much use here — though nothing stops you bringing
            one in if you price maintenance jobs as projects.
          </p>
        </div>

        {!catalogue && !notFound && (
          <button
            type="button"
            onClick={() => void find()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy === 'find' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Find my KYN numbers
          </button>
        )}

        {notFound && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{notFound}</p>
              <p className="mt-1 text-xs text-amber-800">
                KYN and BidClaw are matched by email address, so this looks for
                a KYN account under the same one you signed in with.
              </p>
            </div>
          </div>
        )}

        {catalogue && catalogue.length === 0 && (
          <p className="text-sm text-gray-500">
            No saved Know Your Numbers models found under this email.
          </p>
        )}

        {model && (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Year</span>
              <select
                value={year ?? ''}
                onChange={(e) => {
                  setYear(Number(e.target.value))
                  setPicked([])
                  clearPreview()
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
              >
                {catalogue!.map((m) => (
                  <option key={m.year} value={m.year}>
                    {m.year}
                    {m.company_name ? ` — ${m.company_name}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">
                Which divisions? Each becomes a division in BidClaw.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {model.divisions
                  .filter((d) => d.crews > 0 || d.equipment > 0)
                  .map((d) => {
                    const on = picked.includes(d.index)
                    return (
                      <label
                        key={d.index}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition ${
                          on
                            ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                            : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(d.index)}
                          disabled={busy !== null}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>
                          <span className="block font-semibold text-gray-900">
                            {d.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {d.crews} crew{d.crews === 1 ? '' : 's'} ·{' '}
                            {d.equipment} machine{d.equipment === 1 ? '' : 's'}
                          </span>
                        </span>
                      </label>
                    )
                  })}
              </div>
            </div>

            {picked.length > 0 && !plans && (
              <button
                type="button"
                onClick={() => void preview()}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
              >
                {busy === 'preview' && <Loader2 className="h-4 w-4 animate-spin" />}
                Show me what will come across
              </button>
            )}
          </>
        )}

        {plans && markupPlan && (
          <div className="space-y-5 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
            <p className="text-sm font-semibold text-gray-900">
              Here's exactly what will land
            </p>

            {plans.map((p) => (
              <div key={p.kynIndex} className="space-y-3">
                <p className="text-sm font-bold text-gray-900">
                  {p.division}
                  {p.isNewDivision && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                      new division
                    </span>
                  )}
                </p>
                <PreviewList
                  title="Labor types"
                  rows={p.labor.incoming}
                  counts={p.labor}
                />
                <PreviewList
                  title="Equipment rates"
                  rows={p.equipment.incoming}
                  counts={p.equipment}
                  note="Hourly charge derived from KYN's ownership-cost model — purchase price, salvage, life, hours, fuel and repairs — using KYN's own formula."
                />
                {Object.keys(p.unmappedMarkups).length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      KYN also carries{' '}
                      {Object.entries(p.unmappedMarkups)
                        .map(([k, v]) => `${k} ${v}%`)
                        .join(', ')}{' '}
                      on this division. BidClaw only has materials and subs
                      markups, so those won't come across — fold them into a
                      line's own markup.
                    </span>
                  </div>
                )}
              </div>
            ))}

            <div className="border-t border-gray-200 pt-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-800">Markups: </span>
              {markupPlan.materials !== null
                ? `materials ${markupPlan.materials}%`
                : 'materials unchanged'}
              {', '}
              {markupPlan.subs !== null
                ? `subs ${markupPlan.subs}%`
                : 'subs unchanged'}
              {plans.length > 1 && (
                <span className="text-gray-500">
                  {' '}
                  — taken from {markupPlan.fromDivision}. Markups are
                  company-wide in BidClaw, so only one division's can apply.
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Existing rows in each division are overwritten in order and
              extras are added. Nothing is deleted, so kits you've already
              built keep working.
            </p>

            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy === 'apply' && <Loader2 className="h-4 w-4 animate-spin" />}
              Import these numbers
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewList({
  title,
  rows,
  counts,
  note,
}: {
  title: string
  rows: { name: string; rate: number }[]
  counts: { overwrites: number; appends: number; untouched: number }
  note?: string
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        <span className="font-semibold text-gray-700">{title}:</span> nothing to
        import from this division.
      </p>
    )
  }
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700">
        {title}{' '}
        <span className="font-normal text-gray-500">
          — {counts.overwrites} overwritten, {counts.appends} added,{' '}
          {counts.untouched} left alone
        </span>
      </p>
      {note && <p className="mt-0.5 text-[11px] text-gray-400">{note}</p>}
      <ul className="mt-1.5 divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 bg-white">
        {rows.map((r, i) => (
          <li
            key={`${r.name}-${i}`}
            className="flex items-baseline justify-between px-3 py-1.5 text-sm"
          >
            <span className="truncate text-gray-800">{r.name}</span>
            <span className="ml-3 shrink-0 font-semibold tabular-nums text-gray-900">
              ${r.rate.toFixed(2)}
              <span className="ml-0.5 text-xs font-normal text-gray-400">/hr</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default KynImportCard
