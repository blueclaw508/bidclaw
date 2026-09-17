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
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { extractProposalText, prepareRebuild, type SubcontractRule, type RebuildOptions } from '@/lib/proposalImport'
import type { Lead } from '@/lib/types'
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
  sourceLead,
}: {
  sourceLead?: Lead
  open: boolean
  onClose: () => void
}) {
  const { user, workspaceOwnerId } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const requestId = useRef(crypto.randomUUID())
  const [options, setOptions] = useState<RebuildOptions>({instructions:'',subcontractScope:'',subcontractor:'',markup:10,basis:'selling'})
  const [rules, setRules] = useState<Record<number, SubcontractRule>>({})
  const [selectedOptions, setSelectedOptions] = useState<number[]>([])
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
    requestId.current = crypto.randomUUID(); setRules({}); setSelectedOptions([])
    setOptions({instructions:'',subcontractScope:'',subcontractor:'',markup:10,basis:'selling'})
  }, [open])

  // Rotate the reassuring status line while Jamie works.
  useEffect(() => {
    if (step !== 'ingesting') return
    const id = window.setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 4000)
    return () => window.clearInterval(id)
  }, [step])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setExtracting(true)
    setText(''); setFileName(null)
    try { setText(await extractProposalText(file)); setFileName(file.name) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not read this proposal.') }
    finally { setExtracting(false) }
  }

  const startIngestion = useCallback(async () => {
    const proposal = text.trim()
    if (proposal.length < 40) {
      toast.error('Add the proposal text (upload a PDF / Word file or paste it) first.')
      return
    }
    if (options.subcontractScope.trim() && (!options.subcontractor.trim() || !Number.isFinite(options.markup) || options.markup < 0 || options.markup > 200)) { toast.error('Enter the subcontractor and a markup from 0 to 200%.'); return }
    setStep('ingesting')
    setWaSoFar(0)
    try {
      const result = await runIngestion(proposal, (acc) => setWaSoFar(countWorkAreasSoFar(acc)), options)
      setRecon(result)
      setRules(Object.fromEntries(result.work_areas.flatMap((area, i) => area.subcontracted ? [[i, {name:options.subcontractor || 'Subcontractor',markup:options.markup,basis:options.basis}]] : [])))
      setSelectedOptions([])
      requestId.current = crypto.randomUUID()
      setEstimateName(
        sourceLead?.project_name || (result.customer_name?.trim()
          ? `${result.customer_name.trim()} — imported`
          : 'Imported proposal')
      )
      setStep('review')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ingestion failed.')
      setStep('input')
    }
  }, [text, options, sourceLead])

  const commit = useCallback(async () => {
    if (!recon || !user) return
    setStep('committing')
    try {
      const res = await commitIngestedProposal({
        client: supabase,
        userId: workspaceOwnerId!,
        proposalName: estimateName.trim() || 'Imported proposal',
        reconstruction: prepareRebuild(recon, rules, selectedOptions),
        sourceLeadId: sourceLead?.id,
        requestId: requestId.current,
      })
      toast.success('Estimate created — it’s on the Leads & Bids board too.')
      onClose()
      navigate(`/app/projects/${res.projectId}?tab=work_areas`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the estimate.')
      setStep('review')
    }
  }, [recon, user, workspaceOwnerId, estimateName, navigate, onClose, rules, selectedOptions, sourceLead])

  let reviewed: IngestReconstruction | null = null
  let reviewError = ''
  if (recon) { try { reviewed = prepareRebuild(recon, rules, selectedOptions) } catch (e) { reviewError = e instanceof Error ? e.message : 'Check subcontract pricing.' } }
  const setRule = (i: number, change: Partial<SubcontractRule>) => setRules(prev => ({...prev,[i]:{...prev[i],...change}}))

  return (
    <Modal
      open={open}
      onClose={step === 'ingesting' || step === 'committing' ? () => {} : onClose}
      title="Upload Proposal & Re-build with Jamie"
      description="Bring a proposal you built outside BidClaw. Jamie rebuilds the work areas and line items to match — you review, then it lands as an estimate."
      size="lg"
    >
      {step === 'input' && (
        <div className="space-y-4">
          <button
            type="button"
            disabled={extracting}
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand-border bg-brand-surface px-4 py-8 text-center transition-colors hover:border-brand-navy hover:bg-blue-50/40"
          >
            {extracting ? (
              <Loader2 className="h-7 w-7 animate-spin text-brand-navy" />
            ) : (
              <FileUp className="h-7 w-7 text-brand-navy" />
            )}
            <span className="text-sm font-semibold text-brand-text">
              {extracting ? 'Reading the proposal…' : fileName ? fileName : 'Upload a Word or PDF proposal'}
            </span>
            <span className="text-xs text-brand-text-muted">
              {fileName && !extracting ? 'Text loaded below — or replace it' : 'PDF or Word (.docx) · up to 25 MB'}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,.doc"
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
          <fieldset className="space-y-3 rounded-lg border border-brand-border p-3">
            <legend className="px-1 font-semibold">How should Jamie rebuild it?</legend>
            <label className="block text-sm">Instructions<textarea maxLength={4000} className={field} rows={2} value={options.instructions} onChange={e => setOptions({...options,instructions:e.target.value})} placeholder="Keep pool pricing and options; price landscape work in detail." /></label>
            <label className="block text-sm">Scope to subcontract (optional)<input maxLength={2000} className={field} value={options.subcontractScope} onChange={e => setOptions({...options,subcontractScope:e.target.value})} placeholder="Pool construction and all pool equipment/options" /></label>
            <label className="block text-sm">Subcontractor<input maxLength={200} className={field} value={options.subcontractor} onChange={e => setOptions({...options,subcontractor:e.target.value})} placeholder="Blue Water Pools & Spas (BWP)" /></label>
            <label className="block text-sm">Markup %<input type="number" min="0" max="200" step="0.1" className={field} value={Number.isNaN(options.markup) ? '' : options.markup} onChange={e => setOptions({...options,markup:e.target.valueAsNumber})} /></label>
            <label className="block text-sm">The uploaded subcontract amount is<select className={field} value={options.basis} onChange={e => setOptions({...options,basis:e.target.value as 'selling'|'cost'})}><option value="selling">Selling price — back out markup and keep that price</option><option value="cost">Subcontractor cost — add markup to that price</option></select></label>
            <p className="text-xs text-brand-text-muted">At 10%, $110,000 selling price becomes $100,000 cost. A $110,000 sub quote becomes $121,000 selling price. You can adjust each work area before saving.</p>
          </fieldset>
          {sourceLead && <p className="text-sm text-brand-text-muted">{sourceLead.project_id ? 'Creates a separate rebuilt estimate, linked in this lead’s notes. The current estimate and proposals stay intact.' : 'Creates an estimate linked to this lead.'}</p>}
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
              <span className="text-lg font-extrabold text-brand-text">{formatUSD(reviewed?.base_total ?? recon.base_total)}</span>
            </div>
            <div className="mt-0.5 text-xs text-brand-text-muted">
              {recon.site_address || 'No site address'} · {reviewed?.work_areas.filter(w => w.kind === 'base').length ?? 0} included work areas
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Estimate name</span>
            <input
              value={estimateName}
              onChange={(e) => setEstimateName(e.target.value)}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>

          <div className="space-y-3">
            {recon.work_areas.map((wa, i) => {
              const rule = rules[i]
              const priced = reviewed?.work_areas[i] ?? wa
              return <section key={i} className="space-y-2 rounded-lg border border-brand-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><strong>{wa.name}</strong><ConfidenceDot c={priced.confidence} /></div>
                <p className="whitespace-pre-line text-brand-text-muted">{wa.scope_description}</p>
                {wa.kind !== 'base' && <label className="flex items-center gap-2"><input type="checkbox" disabled={wa.kind === 'deduct_option'} checked={selectedOptions.includes(i)} onChange={e => setSelectedOptions(prev => e.target.checked ? [...prev,i] : prev.filter(x => x !== i))} />{wa.kind === 'deduct_option' ? 'Deduct option saved in notes; apply the substitution in the estimate editor' : `Include this ${wa.kind.replaceAll('_',' ')} in the estimate`}</label>}
                <label className="block">Pricing<select className={field} value={rule ? 'sub' : 'detail'} onChange={e => setRules(prev => { const next = {...prev}; if (e.target.value === 'sub') next[i] = {name:options.subcontractor || 'Subcontractor',markup:options.markup,basis:options.basis}; else delete next[i]; return next })}><option value="detail">Original Jamie breakdown</option><option value="sub">Subcontractor — preserve scope as a lump sum</option></select></label>
                {rule && <div className="grid gap-2 sm:grid-cols-2">
                  <label>Subcontractor<input className={field} value={rule.name} onChange={e => setRule(i,{name:e.target.value})} /></label>
                  <label>Markup %<input className={field} type="number" min="0" max="200" step="0.1" value={Number.isNaN(rule.markup) ? '' : rule.markup} onChange={e => setRule(i,{markup:e.target.valueAsNumber})} /></label>
                  <label className="sm:col-span-2">Uploaded price basis<select className={field} value={rule.basis} onChange={e => setRule(i,{basis:e.target.value as 'selling'|'cost'})}><option value="selling">Selling price — back out markup</option><option value="cost">Subcontractor cost — add markup</option></select></label>
                </div>}
                <p>Imported: {formatUSD(wa.stated_total)}{rule && <> · Sub cost: {formatUSD(priced.line_items[0]?.unit_cost ?? 0)} · Markup: {rule.markup}%</>} · <strong>Selling price: {formatUSD(priced.stated_total)}</strong></p>
              </section>
            })}
          </div>
          {reviewError && <p role="alert" className="text-red-700">{reviewError}</p>}
          <p className="text-xs text-brand-text-muted">Review the scope and amounts before creating the estimate. Unselected options, payment terms, and exclusions are kept in notes. To change which work Jamie reconstructs in detail, go Back and update the instructions.</p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStep('input')} className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface">Back</button>
            <button
              type="button"
              disabled={!!reviewError || !reviewed?.work_areas.some(w => w.kind === 'base')}
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

const field = 'mt-1 w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm'

export default ImportProposalModal

