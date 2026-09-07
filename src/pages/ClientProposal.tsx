import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Printer,
  XCircle,
} from 'lucide-react'
import { ProposalDocument } from '@/components/proposals/ProposalDocument'
import { SignaturePad } from '@/components/proposals/SignaturePad'
import { showsGrandTotal } from '@/lib/proposalDefaults'
import {
  fetchSharedProposal,
  signSharedProposal,
  SharedProposalError,
  type SharedProposalPayload,
} from '@/lib/proposalShares'
import type { ProposalSignature } from '@/lib/types'

/**
 * The client's copy of a proposal, at /p/:token. No account, no login:
 * the token is the credential and the proposal-share function checks it.
 *
 * Renders the same document the contractor prints (ProposalDocument, in
 * its Summary format — the client proposal, never the cost breakdown),
 * with a decision panel underneath: accept with a typed name and a drawn
 * signature, or decline with a reason. Either way the contractor sees the
 * answer in the editor the next time they open it.
 *
 * Deliberately outside the AppShell and outside AuthProvider's gates. A
 * signed-in contractor previewing their own link sees exactly what the
 * client sees.
 */
export default function ClientProposal() {
  const { token = '' } = useParams<{ token: string }>()
  const [payload, setPayload] = useState<SharedProposalPayload | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // loading starts true and error null from useState; the token in the
    // URL does not change under a mounted page, so nothing to reset here.
    fetchSharedProposal(token)
      .then((p) => {
        if (!cancelled) {
          setPayload(p)
          setError(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof SharedProposalError) setError({ code: err.code, message: err.message })
        else setError({ code: 'server_error', message: 'Something went wrong. Try again.' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const companyName = payload?.settings?.company_legal_name?.trim() || 'Your contractor'

  useEffect(() => {
    if (!payload) return
    const prev = document.title
    document.title = `${payload.proposal.name} · ${companyName}`
    return () => {
      document.title = prev
    }
  }, [payload, companyName])

  const enabledWorkAreas = useMemo(
    () => (payload ? payload.proposal.work_areas.filter((wa) => wa.enabled) : []),
    [payload]
  )

  const onSigned = useCallback((sig: ProposalSignature) => {
    setPayload((p) =>
      p
        ? {
            ...p,
            signature: sig,
            canSign: sig.decision !== 'accepted',
            proposal:
              sig.decision === 'accepted'
                ? { ...p.proposal, status: 'approved', approved_at: sig.signed_at }
                : p.proposal,
          }
        : p
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /* ---------- guards ---------- */

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-gray-100">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Opening your proposal…
        </div>
      </div>
    )
  }

  if (error || !payload) {
    const titles: Record<string, string> = {
      link_not_found: "This link isn't valid",
      link_closed: 'This link was closed',
      link_expired: 'This link has expired',
      proposal_unavailable: 'This proposal is being revised',
    }
    return (
      <div className="flex min-h-svh items-center justify-center bg-gray-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-gray-900">
            {titles[error?.code ?? ''] ?? 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {error?.message ?? 'Try again in a moment.'}
          </p>
          <p className="mt-4 text-xs text-gray-400">
            If you were expecting a proposal, ask your contractor for a fresh link.
          </p>
        </div>
      </div>
    )
  }

  const { proposal, project, customer, settings, logoUrl, signature, canSign } = payload
  const accent = settings.pdf_primary_color || '#1e3a8a'
  const accepted = signature?.decision === 'accepted'
  const declined = signature?.decision === 'declined'
  const showTotal = showsGrandTotal(proposal, settings)

  return (
    <div className="pv-root min-h-svh bg-gray-100 print:bg-white">
      {/* ───── Top bar — screen only ───── */}
      <div className="pv-toolbar sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-[850px] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-5 w-5 shrink-0" style={{ color: accent }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{companyName}</p>
              <p className="truncate text-xs text-gray-500">Proposal for your review</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill accepted={accepted} declined={declined} canSign={canSign} />
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>
      </div>

      {/* ───── Outcome banners — screen only ───── */}
      {accepted && signature && (
        <div className="mx-auto mt-4 flex max-w-[850px] items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Accepted by <strong>{signature.signer_name}</strong> on {formatDate(signature.signed_at)}.{' '}
            {companyName} has your signed copy. Print this page or save it as a PDF for your records.
          </span>
        </div>
      )}
      {declined && signature && canSign && (
        <div className="mx-auto mt-4 flex max-w-[850px] items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You declined this proposal on {formatDate(signature.signed_at)}. Changed your mind?
            You can still accept it below.
          </span>
        </div>
      )}
      {canSign && !declined && (
        <div className="mx-auto mt-4 flex max-w-[850px] items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 print:hidden">
          <PenLine className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Read it through. When you're ready,{' '}
            <a href="#decision" className="font-semibold underline">
              accept or decline at the bottom
            </a>
            .
          </span>
        </div>
      )}

      {/* ───── The document — screen AND print ───── */}
      <div className="pv-document mx-auto my-6 max-w-[850px] bg-white p-8 shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none sm:p-12">
        <ProposalDocument
          settings={settings}
          proposal={proposal}
          project={project}
          customer={customer}
          enabledWorkAreas={enabledWorkAreas}
          accent={accent}
          logoUrl={logoUrl}
          format="summary"
          showTotal={showTotal}
          signature={accepted ? signature : null}
        />
      </div>

      {/* ───── Decision — screen only ───── */}
      {canSign && (
        <DecisionPanel
          token={token}
          companyName={companyName}
          accent={accent}
          defaultName={customer?.name ?? ''}
          defaultEmail={customer?.email ?? ''}
          onSigned={onSigned}
        />
      )}

      <p className="pb-10 text-center text-xs text-gray-400 print:hidden">
        Sent with BidClaw
      </p>
    </div>
  )
}

/* ============================================================
 * Status pill
 * ============================================================ */

function StatusPill({
  accepted,
  declined,
  canSign,
}: {
  accepted: boolean
  declined: boolean
  canSign: boolean
}) {
  if (accepted) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Accepted
      </span>
    )
  }
  if (declined && !canSign) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
        <XCircle className="h-3.5 w-3.5" />
        Declined
      </span>
    )
  }
  if (canSign) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
        <PenLine className="h-3.5 w-3.5" />
        Awaiting your decision
      </span>
    )
  }
  return null
}

/* ============================================================
 * Decision panel — accept with a signature, or decline with a reason
 * ============================================================ */

function DecisionPanel({
  token,
  companyName,
  accent,
  defaultName,
  defaultEmail,
  onSigned,
}: {
  token: string
  companyName: string
  accent: string
  defaultName: string
  defaultEmail: string
  onSigned: (sig: ProposalSignature) => void
}) {
  const [mode, setMode] = useState<'accept' | 'decline'>('accept')
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignature = useCallback((d: string | null) => setSignatureData(d), [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 2) {
      setError('Type your full name.')
      return
    }
    if (mode === 'accept') {
      if (!signatureData) {
        setError('Draw your signature in the box.')
        return
      }
      if (!agree) {
        setError('Tick the box to confirm you agree to the terms.')
        return
      }
    }
    setSubmitting(true)
    try {
      const sig = await signSharedProposal(token, {
        decision: mode === 'accept' ? 'accepted' : 'declined',
        signer_name: name.trim(),
        signer_email: email.trim() || undefined,
        signature_data: mode === 'accept' ? (signatureData ?? undefined) : undefined,
        decline_reason: mode === 'decline' ? reason.trim() || undefined : undefined,
        agree: mode === 'accept' ? agree : undefined,
      })
      onSigned(sig)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const tab = (m: 'accept' | 'decline', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m)
        setError(null)
      }}
      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
        mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  )

  return (
    <section
      id="decision"
      className="mx-auto mb-8 max-w-[850px] rounded-2xl border border-gray-200 bg-white p-6 shadow-sm print:hidden sm:p-8"
    >
      <h2 className="text-lg font-bold text-gray-900">Your decision</h2>
      <p className="mt-1 text-sm text-gray-600">
        {companyName} will see your answer right away.
      </p>

      <div role="tablist" className="mt-4 inline-flex rounded-lg bg-gray-100 p-1">
        {tab('accept', 'Accept and sign')}
        {tab('decline', 'Decline')}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Your full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              placeholder="As it should appear on the proposal"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Email <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              placeholder="you@example.com"
            />
          </div>
        </div>

        {mode === 'accept' ? (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Your signature</label>
              <SignaturePad onChange={handleSignature} disabled={submitting} />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                I have read this proposal and agree to its scope, price, terms, and payment
                schedule. My drawn signature is my signature.
              </span>
            </label>
          </>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Reason <span className="font-normal text-gray-400">(optional, but it helps)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              placeholder="Going a different direction, the price, the timing…"
            />
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            style={mode === 'accept' ? { backgroundColor: accent } : undefined}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${
              mode === 'accept' ? 'hover:brightness-110' : 'bg-gray-800 hover:bg-gray-900'
            }`}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === 'accept' ? (
              <PenLine className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {submitting
              ? 'Sending…'
              : mode === 'accept'
                ? 'Accept and sign'
                : 'Decline this proposal'}
          </button>
          <span className="text-xs text-gray-500">
            {mode === 'accept'
              ? 'Your name, signature, and the time are recorded with the proposal.'
              : 'You can still accept later while the link is open.'}
          </span>
        </div>
      </form>
    </section>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
