// Import a proposal built outside BidClaw (PDF upload or pasted text) →
// Jamie reverse-ingests it → review the reconstructed work areas → commit
// to a real estimate that lands on Leads & Bids. Founder-gated at the
// entry point (Projects page); the server re-checks the gate.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CircleCheck,
  FileUp,
  Loader2,
  Sparkles,
  Upload,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { extractPdfText } from '@/lib/pdfText'
import { countWorkAreasSoFar, runIngestion } from '@/lib/jamieIngest'
import { commitIngestedProposal, type IngestReconstruction } from '@/lib/ingest'
import { formatUSD } from '@/lib/money'
import { cn } from '@/lib/utils'

type Step = 'input' | 'ingesting' | 'review' | 'committing'

const STATUS_LINES = [
  'Reading your proposal…',
  'Finding the work areas…',
  'Reconstructing the line-item takeoff…',
  'Matching your catalog and rates…',
  'Reconciling every total to the penny…',
]

export function ImportProposalModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [waSoFar, setWaSoFar] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)
  const [recon, setRecon] = useState<IngestReconstruction | null>(null)
  const [estimateName, setEstimateName] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('input'); setText(''); setFileName(null); setExtracting(false)
    setWaSoFar(0); setStatusIdx(0); setRecon(null); setEstimateName('')
  }, [open])

  // Rotate the reassuring status line while Jamie works.
  useEffect(() => {
    if (step !== 'ingesting') return
    const id = window.setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 4000)
    return () => window.clearInterval(id)
  }, [step])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      setExtracting(true)
      try {
        setText(await extractPdfText(file))
      } catch {
        toast.error("Couldn't read that PDF. Try pasting the text instead.")
        setFileName(null)
      } finally {
        setExtracting(false)
      }
    } else {
      toast('For Word or other files, open the doc and paste the text below.', { icon: '📋' })
      setFileName(null)
    }
  }

  const startIngestion = useCallback(async () => {
    const proposal = text.trim()
    if (proposal.length < 40) {
      toast.error('Add the proposal text (upload a PDF or paste it) first.')
      return
    }
    setStep('ingesting')
    setWaSoFar(0)
    try {
      const result = await runIngestion(proposal, (acc) => setWaSoFar(countWorkAreasSoFar(acc)))
      setRecon(result)
      setEstimateName(
        result.customer_name?.trim()
          ? `${result.customer_name.trim()} — imported`
          : 'Imported proposal'
      )
      setStep('review')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ingestion failed.')
      setStep('input')
    }
  }, [text])

  const commit = useCallback(async () => {
    if (!recon || !user) return
    setStep('committing')
    try {
      const res = await commitIngestedProposal({
        client: supabase,
        userId: user.id,
        proposalName: estimateName.trim() || 'Imported proposal',
        reconstruction: recon,
      })
      toast.success('Estimate created — it’s on the Leads & Bids board too.')
      onClose()
      navigate(`/app/projects/${res.projectId}?tab=work_areas`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the estimate.')
      setStep('review')
    }
  }, [recon, user, estimateName, navigate, onClose])

  const baseWAs = recon?.work_areas.filter((w) => w.kind === 'base') ?? []
  const optionWAs = recon?.work_areas.filter((w) => w.kind !== 'base') ?? []
  const hasPool = recon?.work_areas.some((w) =>
    /gunite|swimming pool|\bspa\b|baja|salt generator|omnilogic|pool cover/i.test(w.name)
  )

  return (
    <Modal
      open={open}
      onClose={step === 'ingesting' || step === 'committing' ? () => {} : onClose}
      title="Import a proposal"
      description="Bring a proposal you built outside BidClaw. Jamie rebuilds the work areas and line items to match — you review, then it lands as an estimate."
      size="lg"
    >
      {step === 'input' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand-border bg-brand-surface px-4 py-8 text-center transition-colors hover:border-brand-navy hover:bg-blue-50/40"
          >
            {extracting ? (
              <Loader2 className="h-7 w-7 animate-spin text-brand-navy" />
            ) : (
              <FileUp className="h-7 w-7 text-brand-navy" />
            )}
            <span className="text-sm font-semibold text-brand-text">
              {extracting ? 'Reading the PDF…' : fileName ? fileName : 'Upload a PDF proposal'}
            </span>
            <span className="text-xs text-brand-text-muted">
              {fileName && !extracting ? 'Text loaded below — or replace it' : 'Click to choose a PDF'}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <div className="relative text-center">
            <span className="bg-white px-2 text-xs uppercase tracking-wide text-brand-text-muted">or paste the text</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Paste the full proposal text here — works for Word, CoWork, email, anything. Jamie skips the terms & conditions."
            className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface">Cancel</button>
            <button
              type="button"
              onClick={() => void startIngestion()}
              disabled={text.trim().length < 40 || extracting}
              className="inline-flex items-center gap-2 rounded-md bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-gold-dark disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              Rebuild with Jamie
            </button>
          </div>
        </div>
      )}

      {step === 'ingesting' && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="relative flex h-14 w-14 items-center justify-center">
            <Loader2 className="absolute h-14 w-14 animate-spin text-brand-gold/40" />
            <Sparkles className="h-6 w-6 text-brand-gold" />
          </span>
          <div>
            <p className="text-sm font-semibold text-brand-text">{STATUS_LINES[statusIdx]}</p>
            <p className="mt-1 text-xs text-brand-text-muted">
              {waSoFar > 0 ? `${waSoFar} work area${waSoFar === 1 ? '' : 's'} so far` : 'A big proposal can take a minute or two.'}
            </p>
          </div>
        </div>
      )}

      {step === 'review' && recon && (
        <div className="space-y-4">
          <div className="rounded-lg border border-brand-border bg-brand-surface px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-brand-text">{recon.customer_name || 'Unknown customer'}</span>
              <span className="text-lg font-extrabold text-brand-text">{formatUSD(recon.base_total)}</span>
            </div>
            <div className="mt-0.5 text-xs text-brand-text-muted">
              {recon.site_address || 'No site address'} · {baseWAs.length} work areas
              {optionWAs.length > 0 && ` · ${optionWAs.length} option${optionWAs.length === 1 ? '' : 's'} → notes`}
            </div>
            {hasPool && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 ring-1 ring-blue-200">
                <Waves className="h-3 w-3" /> Pool scope coded to Blue Water Pools (subcontractor)
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Estimate name</span>
            <input
              value={estimateName}
              onChange={(e) => setEstimateName(e.target.value)}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>

          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-brand-border p-2">
            {baseWAs.map((wa, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-brand-surface">
                <div className="min-w-0">
                  <div className="truncate font-medium text-brand-text">{wa.name}</div>
                  <div className="text-[11px] text-brand-text-muted">{wa.line_items.length} lines</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ConfidenceDot c={wa.confidence} />
                  <span className="font-semibold tabular-nums text-brand-text">{formatUSD(wa.stated_total)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-brand-text-muted">
            Totals are locked to your proposal exactly. The dots flag how confident Jamie is in the line breakdown —
            <span className="text-amber-600"> amber</span>/<span className="text-rose-600">red</span> are worth a look in the editor after. Options, payment terms, and exclusions are saved to the estimate notes.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStep('input')} className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface">Back</button>
            <button
              type="button"
              onClick={() => void commit()}
              className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
            >
              <CircleCheck className="h-4 w-4" />
              Create estimate
            </button>
          </div>
        </div>
      )}

      {step === 'committing' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Upload className="h-8 w-8 animate-pulse text-brand-navy" />
          <p className="text-sm font-semibold text-brand-text">Building your estimate…</p>
        </div>
      )}
    </Modal>
  )
}

function ConfidenceDot({ c }: { c?: string }) {
  const color = c === 'high' ? 'bg-emerald-500' : c === 'low' ? 'bg-rose-500' : 'bg-amber-400'
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', color)} title={`${c ?? 'medium'} confidence line breakdown`} />
}

export default ImportProposalModal
