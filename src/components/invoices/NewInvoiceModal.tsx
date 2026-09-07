import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { getProposal } from '@/lib/proposals'
import { resolvePaymentMilestones, resolvePaymentTerms } from '@/lib/proposalDefaults'
import { formatUSD, lineTotal, roundMoney, sumMoney } from '@/lib/money'
import {
  buildMilestoneLines,
  changeOrderLine,
  createInvoice,
  invoicedPercentForProposal,
  isInvoiceGateError,
  type NewInvoiceLine,
} from '@/lib/invoices'
import { addDaysIso, todayIso } from '@/lib/invoiceStatus'
import type {
  ChangeOrder,
  CompanySettings,
  PaymentMilestone,
  ProposalListRow,
  ProposalWithWorkAreas,
} from '@/lib/types'

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20'

type Source = 'milestone' | 'custom' | 'blank'

/**
 * Create an invoice from a proposal's payment schedule (the common case),
 * from a custom percent of the contract, or blank for anything else.
 * Milestone and custom invoices carry one line per work area so the WIP
 * schedule can read billings by area later. Approved, un-invoiced change
 * orders can ride along as extra lines.
 */
export function NewInvoiceModal({
  open,
  onClose,
  projectId,
  proposals,
  changeOrders,
  settings,
  onCreated,
  onGateError,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  /** Proposals worth billing against: approved and beyond. */
  proposals: ProposalListRow[]
  /** Approved change orders not yet on a live invoice. */
  changeOrders: ChangeOrder[]
  settings: CompanySettings
  onCreated: (invoiceId: string) => void
  onGateError: (err: unknown) => void
}) {
  const [proposalId, setProposalId] = useState<string>('')
  const [proposal, setProposal] = useState<ProposalWithWorkAreas | null>(null)
  const [billedPct, setBilledPct] = useState(0)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<Source>('milestone')
  const [milestoneIdx, setMilestoneIdx] = useState<number | null>(null)
  const [customPct, setCustomPct] = useState('')
  const [customLabel, setCustomLabel] = useState('Progress billing')
  const [issueDate, setIssueDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), settings.invoice_due_days ?? 15))
  const [coIds, setCoIds] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  // Reset on open; preselect the only proposal when there is one.
  useEffect(() => {
    if (!open) return
    const first = proposals[0]?.id ?? ''
    setProposalId(proposals.length === 1 ? first : '')
    setProposal(null)
    setBilledPct(0)
    setSource(proposals.length > 0 ? 'milestone' : 'blank')
    setMilestoneIdx(null)
    setCustomPct('')
    setCustomLabel('Progress billing')
    const today = todayIso()
    setIssueDate(today)
    setDueDate(addDaysIso(today, settings.invoice_due_days ?? 15))
    setCoIds(new Set())
  }, [open, proposals, settings.invoice_due_days])

  // Load the chosen proposal and how much of it is already billed.
  useEffect(() => {
    if (!open || !proposalId) {
      setProposal(null)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([getProposal(proposalId), invoicedPercentForProposal(proposalId)])
      .then(([p, pct]) => {
        if (cancelled) return
        setProposal(p)
        setBilledPct(pct)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Couldn't load that proposal.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, proposalId])

  const milestones: PaymentMilestone[] = useMemo(
    () => (proposal ? resolvePaymentMilestones(proposal, settings) : []),
    [proposal, settings]
  )
  const contractTotal = useMemo(
    () =>
      proposal
        ? sumMoney(
            proposal.work_areas
              .filter((wa) => wa.enabled)
              .map((wa) => sumMoney(wa.lines.map((l) => lineTotal(l))))
          )
        : 0,
    [proposal]
  )

  // Which milestone is next: the first one whose cumulative percent is
  // beyond what has been billed. Preselect it.
  useEffect(() => {
    if (!proposal || milestones.length === 0) return
    let cum = 0
    for (let i = 0; i < milestones.length; i++) {
      cum = roundMoney(cum + Number(milestones[i].percent))
      if (cum > billedPct + 0.001) {
        setMilestoneIdx(i)
        return
      }
    }
    setMilestoneIdx(null)
  }, [proposal, milestones, billedPct])

  const coTotal = useMemo(
    () => sumMoney(changeOrders.filter((c) => coIds.has(c.id)).map((c) => c.amount)),
    [changeOrders, coIds]
  )

  const previewLines: NewInvoiceLine[] = useMemo(() => {
    const lines: NewInvoiceLine[] = []
    if (proposal && source === 'milestone' && milestoneIdx !== null && milestones[milestoneIdx]) {
      lines.push(...buildMilestoneLines(proposal, milestones[milestoneIdx]))
    } else if (proposal && source === 'custom') {
      const pct = Number(customPct)
      if (Number.isFinite(pct) && pct > 0) {
        lines.push(...buildMilestoneLines(proposal, { description: customLabel || 'Progress billing', percent: pct }))
      }
    }
    for (const co of changeOrders) if (coIds.has(co.id)) lines.push(changeOrderLine(co))
    return lines
  }, [proposal, source, milestoneIdx, milestones, customPct, customLabel, changeOrders, coIds])

  const previewTotal = sumMoney(previewLines.map((l) => roundMoney(l.quantity * l.unit_price)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (source !== 'blank' && previewLines.length === 0) {
      toast.error('Pick a milestone, or enter a percent above zero.')
      return
    }
    setCreating(true)
    try {
      const chosen = source === 'milestone' && milestoneIdx !== null ? milestones[milestoneIdx] : null
      const id = await createInvoice({
        projectId,
        proposalId: proposalId || null,
        milestoneLabel:
          source === 'milestone' ? (chosen?.description ?? null) : source === 'custom' ? customLabel || 'Progress billing' : null,
        milestonePercent:
          source === 'milestone' ? (chosen ? Number(chosen.percent) : null) : source === 'custom' ? Number(customPct) || null : null,
        issueDate,
        dueDate: dueDate || null,
        terms: resolvePaymentTerms(settings),
        lines: previewLines,
      })
      onCreated(id)
      onClose()
    } catch (err) {
      if (isInvoiceGateError(err)) {
        onClose()
        onGateError(err)
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't create the invoice.")
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={creating ? () => {} : onClose} title="New invoice" size="xl">
      <form onSubmit={submit} className="space-y-5">
        {/* Proposal */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Bill against
          </label>
          {proposals.length > 0 ? (
            <select
              value={proposalId}
              onChange={(e) => {
                setProposalId(e.target.value)
                if (!e.target.value) setSource('blank')
                else if (source === 'blank') setSource('milestone')
              }}
              className={inputCls}
            >
              <option value="">No proposal (blank invoice)</option>
              {proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatUSD(p.grand_total)} · {p.status.replace('_', ' ')}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-gray-600">
              No approved proposal on this project yet. A blank invoice is fine for a deposit or a
              one-off; milestone billing needs an approved proposal.
            </p>
          )}
          {proposal && (
            <p className="mt-1 text-xs text-gray-500">
              Contract {formatUSD(contractTotal)} · {billedPct}% billed so far
            </p>
          )}
        </div>

        {/* Source */}
        {proposal && (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg bg-gray-100 p-1">
              {(
                [
                  ['milestone', 'From the schedule'],
                  ['custom', 'Custom percent'],
                  ['blank', 'Blank'],
                ] as Array<[Source, string]>
              ).map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    source === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {source === 'milestone' && (
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {milestones.length === 0 && (
                  <p className="p-3 text-sm text-gray-500">This proposal has no payment schedule.</p>
                )}
                {milestones.map((m, i) => {
                  const cumBefore = milestones.slice(0, i).reduce((s, x) => s + Number(x.percent), 0)
                  const billed = cumBefore + Number(m.percent) <= billedPct + 0.001
                  return (
                    <label
                      key={i}
                      className={`flex cursor-pointer items-center gap-3 p-3 text-sm ${
                        billed ? 'text-gray-400' : 'text-gray-900'
                      }`}
                    >
                      <input
                        type="radio"
                        name="milestone"
                        checked={milestoneIdx === i}
                        onChange={() => setMilestoneIdx(i)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">
                        {m.description}
                        {billed ? <span className="ml-2 text-xs">(already billed)</span> : null}
                      </span>
                      <span className="tabular-nums">{Number(m.percent)}%</span>
                      <span className="w-24 text-right tabular-nums font-semibold">
                        {formatUSD(roundMoney((contractTotal * Number(m.percent)) / 100))}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {source === 'custom' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Label</label>
                  <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Percent of contract</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    value={customPct}
                    onChange={(e) => setCustomPct(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 25"
                  />
                </div>
              </div>
            )}

            {source === 'blank' && (
              <p className="text-sm text-gray-600">
                Starts empty. Add lines on the next screen.
              </p>
            )}
          </div>
        )}

        {/* Change orders */}
        {changeOrders.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Include approved change orders
            </label>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {changeOrders.map((co) => (
                <label key={co.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm text-gray-900">
                  <input
                    type="checkbox"
                    checked={coIds.has(co.id)}
                    onChange={(e) => {
                      const next = new Set(coIds)
                      if (e.target.checked) next.add(co.id)
                      else next.delete(co.id)
                      setCoIds(next)
                    }}
                    className="h-4 w-4 rounded"
                  />
                  <span className="flex-1">
                    #{co.change_number} {co.title}
                  </span>
                  <span className="tabular-nums font-semibold">{formatUSD(co.amount)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Invoice date</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value)
                if (e.target.value) setDueDate(addDaysIso(e.target.value, settings.invoice_due_days ?? 15))
              }}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Due</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Preview */}
        {previewLines.length > 0 && (
          <div className="rounded-lg bg-gray-50 p-3">
            <ul className="space-y-1 text-xs text-gray-700">
              {previewLines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">{l.description}</span>
                  <span className="shrink-0 tabular-nums">{formatUSD(roundMoney(l.quantity * l.unit_price))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
              <span>Invoice total</span>
              <span className="tabular-nums">{formatUSD(previewTotal)}</span>
            </div>
            {coTotal > 0 && (
              <p className="mt-1 text-[11px] text-gray-500">Includes {formatUSD(coTotal)} in change orders.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {(creating || loading) && <Loader2 className="h-4 w-4 animate-spin" />}
            Create invoice
          </button>
        </div>
      </form>
    </Modal>
  )
}
