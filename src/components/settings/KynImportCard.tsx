import { useState } from 'react'
import { Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyKynImport,
  loadKynCatalogue,
  previewKynImport,
  KynSyncError,
  type KynImportPlan,
  type KynModelSummary,
} from '@/lib/kynSync'

/**
 * Import My Numbers from Know Your Numbers.
 *
 * Three deliberate steps — find, preview, import — because this writes over
 * numbers the contractor may have typed themselves. Nothing is written until
 * they have seen the exact rates that will land, machine by machine.
 *
 * BidClaw is a CONSTRUCTION estimator; maintenance work belongs in
 * RouteClaw. KYN models are divisional and often carry both, so the
 * contractor picks the division rather than having one guessed for them —
 * matching on the name would be a heuristic built on a field where
 * "Maintanence" is a real, misspelled value in live data.
 */
export function KynImportCard({ onImported }: { onImported: () => void }) {
  const [catalogue, setCatalogue] = useState<KynModelSummary[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [division, setDivision] = useState<number | null>(null)
  const [plan, setPlan] = useState<KynImportPlan | null>(null)
  const [busy, setBusy] = useState<'find' | 'preview' | 'apply' | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)

  const find = async () => {
    setBusy('find')
    setNotFound(null)
    try {
      const { catalogue: c } = await loadKynCatalogue()
      setCatalogue(c)
      if (c.length > 0) {
        setYear(c[0].year)
        setDivision(null)
        setPlan(null)
      }
    } catch (err) {
      if (err instanceof KynSyncError && (err.code === 'NO_KYN_ACCOUNT' || err.code === 'NO_MODEL')) {
        setNotFound(err.message)
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't reach Know Your Numbers.")
      }
    } finally {
      setBusy(null)
    }
  }

  const preview = async (y: number, d: number) => {
    setBusy('preview')
    setDivision(d)
    try {
      const { plan: p } = await previewKynImport(y, d)
      setPlan(p)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that division.")
      setPlan(null)
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (year === null || division === null) return
    setBusy('apply')
    try {
      await applyKynImport(year, division)
      toast.success('Your Know Your Numbers rates are in.')
      setPlan(null)
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
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">Year</span>
                <select
                  value={year ?? ''}
                  onChange={(e) => {
                    setYear(Number(e.target.value))
                    setDivision(null)
                    setPlan(null)
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
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">
                Which division?
              </p>
              <p className="mb-2.5 text-xs text-gray-500">
                BidClaw estimates construction work — maintenance divisions
                belong in RouteClaw.
              </p>
              <div className="flex flex-wrap gap-2">
                {model.divisions
                  .filter((d) => d.crews > 0 || d.equipment > 0)
                  .map((d) => (
                    <button
                      key={d.index}
                      type="button"
                      onClick={() => void preview(model.year, d.index)}
                      disabled={busy !== null}
                      className={`rounded-lg border px-3.5 py-2 text-left text-sm transition disabled:opacity-60 ${
                        division === d.index
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                          : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50/40'
                      }`}
                    >
                      <span className="block font-semibold text-gray-900">
                        {d.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {d.crews} crew{d.crews === 1 ? '' : 's'} ·{' '}
                        {d.equipment} machine{d.equipment === 1 ? '' : 's'}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}

        {busy === 'preview' && (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Working out your rates…
          </p>
        )}

        {plan && busy !== 'preview' && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
            <p className="text-sm font-semibold text-gray-900">
              Here's exactly what will land
            </p>

            <PreviewList
              title="Labor types"
              rows={plan.labor.incoming}
              counts={plan.labor}
            />
            <PreviewList
              title="Equipment rates"
              rows={plan.equipment.incoming}
              counts={plan.equipment}
              note="Hourly charge derived from KYN's ownership-cost model — purchase price, salvage, life, hours, fuel and repairs — using KYN's own formula."
            />

            <div className="text-xs text-gray-600">
              <span className="font-semibold text-gray-800">Markups: </span>
              {plan.markupMaterials !== null
                ? `materials ${plan.markupMaterials}%`
                : 'materials unchanged'}
              {', '}
              {plan.markupSubs !== null
                ? `subs ${plan.markupSubs}%`
                : 'subs unchanged'}
            </div>

            {Object.keys(plan.unmappedMarkups).length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  KYN also carries{' '}
                  {Object.entries(plan.unmappedMarkups)
                    .map(([k, v]) => `${k} ${v}%`)
                    .join(', ')}
                  . BidClaw only has materials and subs markups, so{' '}
                  {Object.keys(plan.unmappedMarkups).length === 1 ? 'that one' : 'those'}{' '}
                  won't come across — you'd fold it into a line's own markup.
                </span>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Existing rows are overwritten in order and extras are added.
              Nothing is deleted, so kits you've already built keep working.
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
