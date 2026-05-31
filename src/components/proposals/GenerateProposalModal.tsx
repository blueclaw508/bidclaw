import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Plus,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { loadKits } from '@/lib/kits'
import {
  addLinesFromKitPreview,
  createProposal,
  previewKitLines,
} from '@/lib/proposals'
import type { Kit, KitPreviewLine, WorkArea } from '@/lib/types'

/**
 * Modal that drives the "generate proposal from kit" flow.
 *
 *   1. Contractor picks a work area (passed in via props — the modal
 *      is opened from a specific work area's card).
 *   2. Contractor picks a kit + confirms input quantity.
 *   3. previewKitLines fetches resolved lines + groups placeholders.
 *   4. Contractor toggles selections + fills placeholder quantities.
 *   5. Commit → createProposal + addLinesFromKitPreview in sequence
 *      → navigate to the new proposal's detail page.
 *
 * State machine (modalState):
 *   • idle       — no kit picked, no preview to fetch
 *   • loading    — kit + qty are set, previewKitLines is in flight
 *   • preview    — lines loaded; user is editing/toggling
 *   • broken     — previewKitLines threw because kit has broken refs;
 *                  show "Open kit" CTA so the contractor can repair
 *   • submitting — createProposal/addLinesFromKitPreview in flight
 */

interface GenerateProposalModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  workArea: WorkArea | null
}

type ModalState = 'idle' | 'loading' | 'preview' | 'broken' | 'submitting'

interface BrokenKitState {
  kitId: string
  kitName: string
  message: string
}

export function GenerateProposalModal({
  open,
  onClose,
  projectId,
  workArea,
}: GenerateProposalModalProps) {
  const navigate = useNavigate()

  /* ---------- state ---------- */

  const [activeKits, setActiveKits] = useState<Kit[]>([])
  const [kitsLoading, setKitsLoading] = useState(false)
  const [kitsError, setKitsError] = useState<string | null>(null)

  const [kitId, setKitId] = useState<string>('')
  const [inputQuantityText, setInputQuantityText] = useState<string>('')
  const [proposalName, setProposalName] = useState<string>('')

  const [previewLines, setPreviewLines] = useState<KitPreviewLine[]>([])
  const [modalState, setModalState] = useState<ModalState>('idle')
  const [brokenKit, setBrokenKit] = useState<BrokenKitState | null>(null)

  /* ---------- reset on open ---------- */

  useEffect(() => {
    if (!open) return
    setKitId('')
    setInputQuantityText('')
    setProposalName('')
    setPreviewLines([])
    setBrokenKit(null)
    setModalState('idle')
  }, [open])

  /* ---------- load kits when modal opens ---------- */

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setKitsLoading(true)
    setKitsError(null)
    loadKits()
      .then((all) => {
        if (cancelled) return
        // Only active kits — archived shouldn't pollute the picker
        setActiveKits(all.filter((k) => k.status === 'active'))
      })
      .catch((err) => {
        if (cancelled) return
        setKitsError(err instanceof Error ? err.message : 'Could not load kits.')
      })
      .finally(() => {
        if (!cancelled) setKitsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  /* ---------- selected kit (resolved from id) ---------- */

  const selectedKit = useMemo<Kit | null>(
    () => activeKits.find((k) => k.id === kitId) ?? null,
    [activeKits, kitId]
  )

  /* ---------- smart-default input quantity when kit changes ---------- */
  // Per Phase 2a decision 3: after kit selection, sum measurements
  // whose calculated_unit matches the kit's input_unit. If a match
  // exists, prefill the field; otherwise leave it empty for manual
  // entry. Query happens here (not on tab load) to avoid N+1.

  useEffect(() => {
    if (!open) return
    if (!workArea || !selectedKit) return
    // Only auto-fill if the field is empty — don't clobber edits
    if (inputQuantityText.trim().length > 0) return

    let cancelled = false
    const fetchQty = async () => {
      const { data, error } = await supabase
        .from('measurements')
        .select('calculated_value, calculated_unit')
        .eq('work_area_id', workArea.id)
      if (cancelled || error || !data) return
      const matchUnit = selectedKit.input_unit.trim().toLowerCase()
      const total = data
        .filter(
          (m) =>
            m.calculated_value != null &&
            (m.calculated_unit ?? '').trim().toLowerCase() === matchUnit
        )
        .reduce((sum, m) => sum + Number(m.calculated_value), 0)
      if (total > 0 && !cancelled) {
        setInputQuantityText(String(total))
      }
    }
    void fetchQty()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workArea?.id, selectedKit?.id])

  /* ---------- proposal name default when kit changes ---------- */

  useEffect(() => {
    if (!open) return
    if (!workArea || !selectedKit) return
    if (proposalName.trim().length > 0) return
    setProposalName(`${workArea.name} — ${selectedKit.name}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workArea?.id, selectedKit?.id])

  /* ---------- parsed input quantity ---------- */

  const inputQuantity = useMemo(() => {
    const n = Number(inputQuantityText)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [inputQuantityText])

  /* ---------- preview fetch (debounced on qty changes) ---------- */
  // Refetch whenever (kitId, inputQuantity) is a valid pair. Debounce
  // by 300ms on quantity changes so dragging through a numeric input
  // doesn't hammer the data layer. Kit changes fire immediately —
  // contractor explicitly picked a different kit.

  useEffect(() => {
    if (!open) return
    if (!kitId || inputQuantity === null) {
      setPreviewLines([])
      setBrokenKit(null)
      setModalState('idle')
      return
    }
    let cancelled = false
    setModalState('loading')
    const t = setTimeout(() => {
      previewKitLines({ kitId, inputQuantity })
        .then((lines) => {
          if (cancelled) return
          setPreviewLines(lines)
          setBrokenKit(null)
          setModalState('preview')
        })
        .catch((err) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : 'Preview failed.'
          // Identify the reference_missing path from the data-layer
          // error message format
          if (message.includes('broken reference')) {
            const kit = activeKits.find((k) => k.id === kitId)
            setBrokenKit({
              kitId,
              kitName: kit?.name ?? 'this kit',
              message,
            })
            setModalState('broken')
          } else {
            toast.error(message)
            setModalState('idle')
          }
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, kitId, inputQuantity, activeKits])

  /* ---------- per-line edits (selected toggle + placeholder qty) ---------- */

  const togglePreviewLine = useCallback((idx: number) => {
    setPreviewLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, selected: !l.selected } : l))
    )
  }, [])

  const setPreviewLineQuantity = useCallback((idx: number, qty: number) => {
    setPreviewLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, quantity: qty } : l))
    )
  }, [])

  /* ---------- placeholder vs resolved partition ---------- */

  const { placeholderLines, resolvedLines, committableCount, grandTotal } = useMemo(() => {
    const ph: Array<KitPreviewLine & { __idx: number }> = []
    const re: Array<KitPreviewLine & { __idx: number }> = []
    let count = 0
    let subtotal = 0
    let markup = 0
    previewLines.forEach((l, idx) => {
      const tagged = { ...l, __idx: idx }
      if (l.placeholder) ph.push(tagged)
      else re.push(tagged)
      if (l.selected && l.quantity > 0) {
        count++
        const lineTotal = l.quantity * l.frozen_unit_cost
        subtotal += lineTotal
        markup += lineTotal * (l.frozen_markup_percent / 100)
      }
    })
    return {
      placeholderLines: ph,
      resolvedLines: re,
      committableCount: count,
      grandTotal: subtotal + markup,
    }
  }, [previewLines])

  /* ---------- commit ---------- */

  const handleSubmit = useCallback(async () => {
    if (!workArea) return
    if (committableCount === 0) {
      toast.error('Select at least one line with a quantity greater than 0.')
      return
    }
    if (!proposalName.trim()) {
      toast.error('Proposal name is required.')
      return
    }
    setModalState('submitting')
    try {
      const proposal = await createProposal({
        projectId,
        workAreaId: workArea.id,
        name: proposalName.trim(),
      })
      await addLinesFromKitPreview({
        proposalId: proposal.id,
        lines: previewLines,
        kitId,
      })
      toast.success(`Proposal created with ${committableCount} lines.`)
      onClose()
      navigate(`/app/projects/${projectId}/proposals/${proposal.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create proposal.')
      setModalState('preview')
    }
  }, [
    workArea,
    committableCount,
    proposalName,
    projectId,
    previewLines,
    kitId,
    onClose,
    navigate,
  ])

  const handleOpenBrokenKit = useCallback(() => {
    if (!brokenKit) return
    onClose()
    navigate(`/app/kits/${brokenKit.kitId}`)
  }, [brokenKit, onClose, navigate])

  /* ---------- derived flags ---------- */

  const isSubmitting = modalState === 'submitting'
  // Unit-mismatch detection lives inline beneath the quantity field
  // (see "No matching measurement found — enter manually." hint).
  // The smart-default heuristic only fires when a measurement matches
  // the kit's input_unit; an empty field after kit selection IS the
  // unit-mismatch signal. Per spec we warn but don't block.

  /* ---------- render ---------- */

  return (
    <Modal
      open={open}
      onClose={isSubmitting ? () => {} : onClose}
      title="Generate proposal from kit"
      description={
        workArea
          ? `Work area: ${workArea.name}`
          : 'Pick a kit and confirm the input quantity'
      }
      size="2xl"
    >
      <div className="space-y-5">
        {/* QC blue gradient info strip — work area context */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-4 text-white">
          <div className="flex items-start gap-3">
            <div className="shrink-0 bg-white/20 p-2 rounded-md">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-blue-100">
                Generating for work area
              </p>
              <p className="truncate text-base font-semibold">
                {workArea?.name ?? '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Picker + quantity + name */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Kit" required className="sm:col-span-2">
            {kitsLoading ? (
              <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                Loading kits…
              </div>
            ) : kitsError ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {kitsError}
              </div>
            ) : activeKits.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                No active kits yet.{' '}
                <a
                  href="/app/kits"
                  className="font-semibold text-brand-navy hover:underline"
                >
                  Create one
                </a>{' '}
                first.
              </div>
            ) : (
              <select
                value={kitId}
                onChange={(e) => setKitId(e.target.value)}
                className={inputClasses}
                disabled={isSubmitting}
              >
                <option value="">Pick a kit…</option>
                {activeKits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} — {k.category} · per {k.input_unit}
                  </option>
                ))}
              </select>
            )}
            {selectedKit && (
              <p className="mt-1 text-xs text-gray-500">
                Each line's factor × input quantity → proposal line quantity.
              </p>
            )}
          </FormField>

          <FormField label={`Input quantity${selectedKit ? ` (${selectedKit.input_unit})` : ''}`} required>
            <input
              type="text"
              inputMode="decimal"
              value={inputQuantityText}
              onChange={(e) => setInputQuantityText(e.target.value)}
              placeholder="0"
              className={inputClasses}
              disabled={!selectedKit || isSubmitting}
            />
            {selectedKit && inputQuantityText.length === 0 && (
              <p className="mt-1 text-xs text-gray-500">
                No matching measurement found — enter manually.
              </p>
            )}
          </FormField>

          <FormField label="Proposal name" required>
            <input
              type="text"
              value={proposalName}
              onChange={(e) => setProposalName(e.target.value)}
              placeholder="Auto-fills after picking a kit"
              className={inputClasses}
              disabled={!selectedKit || isSubmitting}
            />
          </FormField>
        </div>

        {/* Preview area */}
        {modalState === 'loading' && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Resolving kit lines…
          </div>
        )}

        {modalState === 'broken' && brokenKit && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-rose-900">
                  Kit has broken references
                </h3>
                <p className="mt-1 text-sm text-rose-800">{brokenKit.message}</p>
                <button
                  type="button"
                  onClick={handleOpenBrokenKit}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open kit
                </button>
              </div>
            </div>
          </div>
        )}

        {modalState === 'preview' && previewLines.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            This kit has no line items yet. Open the kit to add lines, then come
            back.
          </div>
        )}

        {(modalState === 'preview' || modalState === 'submitting') && previewLines.length > 0 && (
          <div className="space-y-4">
            {/* Needs Input — pinned at top, amber background */}
            {placeholderLines.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60">
                <header className="border-b border-amber-200 bg-amber-100/60 px-4 py-2">
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Needs Input — {placeholderLines.length}
                  </h3>
                </header>
                <ul className="divide-y divide-amber-100">
                  {placeholderLines.map((l) => (
                    <PreviewRow
                      key={`ph-${l.__idx}`}
                      line={l}
                      idx={l.__idx}
                      isPlaceholder
                      onToggle={togglePreviewLine}
                      onQuantityChange={setPreviewLineQuantity}
                      disabled={isSubmitting}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Resolved Lines */}
            {resolvedLines.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <header className="border-b border-gray-100 bg-slate-50 px-4 py-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                    Resolved lines — {resolvedLines.length}
                  </h3>
                </header>
                <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
                  {resolvedLines.map((l) => (
                    <PreviewRow
                      key={`re-${l.__idx}`}
                      line={l}
                      idx={l.__idx}
                      isPlaceholder={false}
                      onToggle={togglePreviewLine}
                      onQuantityChange={setPreviewLineQuantity}
                      disabled={isSubmitting}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Totals strip + actions */}
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Grand total
            </span>
            <span className="text-xl font-bold text-gray-900">
              {formatUSD(grandTotal)}
            </span>
            {committableCount > 0 && (
              <span className="text-xs text-gray-500">
                ({committableCount} line{committableCount === 1 ? '' : 's'})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={
                isSubmitting ||
                committableCount === 0 ||
                modalState === 'broken' ||
                !proposalName.trim()
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
              title={
                committableCount === 0
                  ? 'Select at least one line with a quantity greater than 0'
                  : undefined
              }
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isSubmitting ? 'Creating…' : 'Add to proposal'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ============================================================
 * PreviewRow — single editable line in the preview
 * ============================================================ */

function PreviewRow({
  line,
  idx,
  isPlaceholder,
  onToggle,
  onQuantityChange,
  disabled,
}: {
  line: KitPreviewLine
  idx: number
  isPlaceholder: boolean
  onToggle: (idx: number) => void
  onQuantityChange: (idx: number, qty: number) => void
  disabled?: boolean
}) {
  const lineTotal = line.selected && line.quantity > 0
    ? line.quantity * line.frozen_unit_cost +
      line.quantity * line.frozen_unit_cost * (line.frozen_markup_percent / 100)
    : 0

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <label className="flex flex-1 cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={line.selected}
          onChange={() => onToggle(idx)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
            {line.label}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            <CategoryChip category={line.category} />
            {!isPlaceholder && line.quantity > 0 && (
              <>
                <span className="ml-2">
                  {formatQty(line.quantity)} {line.unit} @ {formatUSD(line.frozen_unit_cost)}
                </span>
                {line.frozen_markup_percent > 0 && (
                  <span className="ml-2 text-gray-400">
                    +{line.frozen_markup_percent}% markup
                  </span>
                )}
              </>
            )}
            {isPlaceholder && (
              <span className="ml-2 italic text-amber-700">
                Enter quantity to include
              </span>
            )}
          </div>
        </div>
      </label>
      {isPlaceholder ? (
        <div className="flex items-center gap-2 sm:w-40">
          <input
            type="text"
            inputMode="decimal"
            value={line.quantity === 0 ? '' : String(line.quantity)}
            onChange={(e) => {
              const v = e.target.value
              if (v.trim() === '') {
                onQuantityChange(idx, 0)
                return
              }
              const n = Number(v)
              if (Number.isFinite(n) && n >= 0) {
                onQuantityChange(idx, n)
              }
            }}
            placeholder="qty"
            disabled={disabled}
            className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          />
          <span className="shrink-0 text-xs text-gray-500">{line.unit}</span>
        </div>
      ) : (
        <span className="shrink-0 text-right text-sm font-semibold text-gray-900 sm:w-32">
          {lineTotal > 0 ? formatUSD(lineTotal) : '—'}
        </span>
      )}
    </li>
  )
}

/* ============================================================
 * Helpers
 * ============================================================ */

function CategoryChip({ category }: { category: KitPreviewLine['category'] }) {
  const styles: Record<KitPreviewLine['category'], string> = {
    material: 'bg-blue-100 text-blue-800',
    labor: 'bg-emerald-100 text-emerald-800',
    equipment: 'bg-amber-100 text-amber-800',
    subcontractor: 'bg-purple-100 text-purple-800',
    other: 'bg-slate-100 text-slate-700',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[category]}`}
    >
      {category}
    </span>
  )
}

const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-gray-50 disabled:text-gray-500'

function FormField({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  )
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '0'
  // Up to 4 decimals; trim trailing zeros for tidiness
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })
}
