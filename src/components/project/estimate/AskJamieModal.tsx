import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ImagePlus,
  Lock,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import {
  askJamie,
  fileToImagePayload,
  jamieCategoryToDb,
  JamieNotEnabledError,
  type JamieLineItem,
  type JamieResult,
} from '@/lib/jamie'
import {
  estimateLineTotal,
  formatUSD,
  type LiveMarkupSettings,
} from '@/lib/money'
import { PROPOSAL_LINE_CATEGORY_LABELS } from '@/lib/statusConfig'
import { canApplySingleAreaResult } from '../../../../supabase/functions/_shared/estimatePolicy.ts'

/**
 * "Ask Jamie" — the AI estimating agent (paid upgrade, Phase 1). The
 * contractor describes a work area's scope (+ optional photo/sketch);
 * Jamie runs the KYN takeoff server-side and returns a priced, reviewable
 * estimate. Nothing is written until the contractor hits "Add to estimate."
 *
 * This modal only opens when the account is entitled — but it still
 * handles a server 403 (JamieNotEnabledError) in case the flag flips.
 */

interface AskJamieModalProps {
  open: boolean
  onClose: () => void
  workAreaId: string
  workAreaName: string
  /**
   * The scope the contractor already typed when they made the work area.
   * It seeds the textarea: they wrote it once, and being asked to write it
   * again is what made this modal feel like it had not been paying
   * attention. They can still edit or add to it before sending.
   */
  workAreaDescription?: string | null
  /** For the live price preview (materials/subs markup). */
  settings: LiveMarkupSettings
  /** Insert Jamie's lines into the estimate. Parent maps + persists. */
  onApply: (lines: JamieLineItem[], clientScope: string) => Promise<void>
}

type Phase = 'input' | 'loading' | 'review' | 'blocked'

export function AskJamieModal({
  open,
  onClose,
  workAreaId,
  workAreaName,
  workAreaDescription,
  settings,
  onApply,
}: AskJamieModalProps) {
  const seeded = (workAreaDescription ?? '').trim()
  const [phase, setPhase] = useState<Phase>('input')
  const [scope, setScope] = useState(seeded)
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null)
  const [result, setResult] = useState<JamieResult | null>(null)
  const [applying, setApplying] = useState(false)
  const [blockedMsg, setBlockedMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const asking = useRef(false)

  const reset = () => {
    setPhase('input')
    setResult(null)
    setApplying(false)
    setAnswers({})
  }

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast.error('Please choose an image (photo, sketch, or plan snapshot).')
      return
    }
    setImage({ file: f, preview: URL.createObjectURL(f) })
  }

  const handleAsk = async (withAnswers = false) => {
    if (asking.current) return
    if (withAnswers && result?.gap_questions.some((_, i) => !answers[i]?.trim())) return
    if (!scope.trim()) {
      toast.error('Tell Jamie about the work first.')
      return
    }
    const nextScope = withAnswers && result
      ? `${scope.trim()}\n\nClarifications from the contractor:\n${result.gap_questions.map((q, i) => `Question: ${q}\nAnswer: ${answers[i].trim()}`).join('\n\n')}`
      : scope.trim()
    asking.current = true
    setPhase('loading')
    try {
      const imagePayload = image ? await fileToImagePayload(image.file) : null
      const res = await askJamie({
        workAreaId,
        workAreaName,
        scope: nextScope,
        image: imagePayload,
      })
      setResult(res)
      setScope(nextScope)
      setAnswers({})
      setPhase('review')
    } catch (err) {
      if (err instanceof JamieNotEnabledError) {
        setBlockedMsg(err.message)
        setPhase('blocked')
        return
      }
      toast.error(err instanceof Error ? err.message : 'Jamie hit a snag.')
      setPhase(result ? 'review' : 'input')
    } finally {
      asking.current = false
    }
  }

  const handleApply = async () => {
    if (!result || applying || !canApplySingleAreaResult(result) || !result.client_scope_description?.trim()) return
    setApplying(true)
    try {
      await onApply(result.line_items, result.client_scope_description.trim())
      toast.success(
        `Jamie added ${result.line_items.length} line${
          result.line_items.length === 1 ? '' : 's'
        } to ${workAreaName}.`
      )
      onClose()
      reset()
      setScope('')
      setImage(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the lines.')
      setApplying(false)
    }
  }

  /** Live preview price for a Jamie line (mirrors estimateLineTotal). */
  const previewPrice = (li: JamieLineItem): number =>
    estimateLineTotal(
      {
        category: jamieCategoryToDb(li.category),
        quantity: li.qty,
        unit_cost: li.unit_cost,
        price_override: null,
      },
      settings
    )

  const grandTotal = result?.line_items.reduce((s, li) => s + previewPrice(li), 0) ?? 0

  /*
   * The actions live in the modal's pinned footer, not at the end of the
   * body. An 18-line takeoff is taller than the screen, and when the
   * buttons rode the bottom of that list the only way to reach "Add to
   * estimate" was to zoom the browser out.
   */
  const footer =
    phase === 'input' ? (
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleAsk()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-gold-dark"
        >
          <Sparkles className="h-4 w-4" />
          Ask Jamie
        </button>
      </div>
    ) : phase === 'review' && result ? (
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={applying}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Start over
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={applying || !canApplySingleAreaResult(result) || !result.client_scope_description?.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {applying ? 'Adding…' : result.gap_questions.length ? 'Answer questions before pricing' : `Add ${result.line_items.length} lines to estimate`}
        </button>
      </div>
    ) : undefined

  return (
    <Modal
      open={open}
      onClose={applying ? () => {} : onClose}
      footer={footer}
      /* A priced result cost a Jamie call, and a request in flight is
         paying for one. Neither should die to a stray click on the
         backdrop — Cancel, Start over and the X are still right there. */
      dismissible={phase === 'input' || phase === 'blocked'}
      title="Ask Jamie"
      description={
        seeded
          ? `Jamie has the scope you wrote for ${workAreaName}. Add anything that changes the price — dimensions, materials, access — then let her price it. You review before anything is added.`
          : `Describe the work in ${workAreaName}. Jamie builds the priced line-item estimate — you review before anything is added.`
      }
      size="2xl"
    >
      {/* ── INPUT ── */}
      {phase === 'input' && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Scope of work
              {seeded && (
                <span className="ml-2 font-medium normal-case tracking-normal text-gray-400">
                  from this work area
                </span>
              )}
            </span>
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={5}
              autoFocus={!seeded}
              placeholder="e.g. Clear the left side of the lawn (~5,000 sf), remove plant material and weeds, transplant the ornamental grasses. Then loam and rough grade for a new lawn."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
            <span className="mt-1 block text-xs text-gray-400">
              {seeded
                ? 'Edit or add to it. The more detail (dimensions, materials, access), the sharper the takeoff.'
                : 'The more detail (dimensions, materials, access), the sharper the takeoff.'}
            </span>
          </label>

          {/* Optional image */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
            {image ? (
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img
                  src={image.preview}
                  alt="scope reference"
                  className="h-14 w-14 rounded object-cover"
                />
                <span className="flex-1 truncate text-xs text-gray-600">
                  {image.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="rounded p-1 text-gray-400 hover:text-rose-500"
                  aria-label="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-brand-navy hover:text-brand-navy"
              >
                <ImagePlus className="h-4 w-4" />
                Add a photo or sketch (optional)
              </button>
            )}
          </div>

        </div>
      )}

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="relative">
            <Sparkles className="h-8 w-8 animate-pulse text-brand-gold" />
          </div>
          <p className="text-sm font-semibold text-gray-800">
            Jamie is checking your scope and answers…
          </p>
          <p className="max-w-xs text-xs text-gray-500">
            Jamie asks for missing details before pricing. Your answers stay in this conversation.
          </p>
        </div>
      )}

      {/* ── BLOCKED (paid upgrade) ── */}
      {phase === 'blocked' && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Lock className="h-8 w-8 text-brand-gold" />
          <p className="text-sm font-semibold text-gray-800">Jamie is a paid upgrade</p>
          <p className="max-w-sm text-xs text-gray-500">{blockedMsg}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
          >
            Got it
          </button>
        </div>
      )}

      {/* ── REVIEW ── */}
      {phase === 'review' && result && (
        <div className="space-y-4">
          {/* Scope narrative */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Jamie's scope
            </h4>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              {result.scope_description}
            </p>
          </section>

          {/* Line items */}
          {result.line_items.length > 0 && (
            <label className="block text-base font-semibold text-brand-navy">
              Client scope — goes on the proposal
              <textarea aria-label="Client scope — goes on the proposal" rows={5}
                value={result.client_scope_description ?? ''}
                onChange={e => setResult(current => current ? { ...current, client_scope_description: e.target.value } : current)}
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-base font-normal" />
              <span className="mt-1 block text-sm font-normal">Review before adding. This will replace the work area's client scope when you add these lines.</span>
            </label>
          )}
          {result.line_items.length > 0 && <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Line items ({result.line_items.length})
            </h4>
            <div className="mt-1 overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-1.5 text-left font-semibold">Item</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Cost</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.line_items.map((li, i) => (
                    <tr key={i} className={li.unit_cost === 0 ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-gray-900">{li.name}</div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">
                          {PROPOSAL_LINE_CATEGORY_LABELS[jamieCategoryToDb(li.category)]}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700">
                        {li.qty} {li.unit}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700">
                          <input
                            type="number" min="0.01" step="0.01"
                            aria-label={`Unit cost for ${li.name}`}
                            value={li.unit_cost || ''}
                            placeholder="Enter cost"
                            className="w-24 rounded border border-amber-400 p-2 text-base"
                            onChange={(e) => {
                              const cost = Number(e.target.value)
                              if (Number.isFinite(cost)) setResult(current => current ? { ...current, line_items: current.line_items.map((line, index) => index === i ? { ...line, unit_cost: cost } : line) } : current)
                            }}
                          />
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                        {formatUSD(previewPrice(li))}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={3} className="px-3 py-2 text-right text-gray-700">
                      Estimated total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-brand-navy">
                      {formatUSD(grandTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>}

          {/* New catalog items (unpriced) */}
          {result.new_catalog_items.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                Confirm any missing unit costs before adding
              </h4>
              <p className="mt-1 text-xs text-amber-700">
                {result.new_catalog_items.join(', ')}. Enter missing costs above. Nothing is automatically saved to your catalog.
              </p>
            </section>
          )}

          {/* Gap questions */}
          {result.gap_questions.length > 0 && (
            <section className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <h4 className="text-base font-bold text-sky-800">
                Answer before Jamie prices this work
              </h4>
              <div className="mt-3 space-y-4 text-base text-sky-900">
                {result.gap_questions.map((q, i) => (
                  <label className="block" key={q}>
                    <span className="mb-1 block">{q}</span>
                    <textarea aria-label={q} rows={2} value={answers[i] ?? ''}
                      onChange={e => setAnswers(current => ({ ...current, [i]: e.target.value }))}
                      className="w-full rounded border border-sky-300 bg-white p-2 text-base"
                      placeholder="Your answer…" />
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => void handleAsk(true)}
                disabled={result.gap_questions.some((_, i) => !answers[i]?.trim())}
                className="mt-3 rounded bg-brand-navy px-4 py-2 text-base font-semibold text-white disabled:opacity-50">
                Send answers to Jamie
              </button>
            </section>
          )}

        </div>
      )}
    </Modal>
  )
}
