import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { isSendGateError, isTrialSendGateError } from '@/lib/entitlements'
import {
  createProposalShare,
  getProposalShare,
  revokeProposalShare,
  shareIsLive,
  shareUrl,
} from '@/lib/proposalShares'
import type { ProposalShare, ProposalSignature } from '@/lib/types'

/**
 * The contractor's side of the client link (0043). Create it, copy it,
 * see whether the client has opened it, replace it, close it. The
 * client's answer — accepted with a signature, or declined with a
 * reason — shows here too, as it does above the editor toolbar.
 *
 * Creating a link marks a draft proposal Sent. The send gate fires on
 * that write; its errors are handed back through onGateError so the
 * editor opens the same upgrade modal the status menu would.
 */
export default function ShareProposalModal({
  open,
  onClose,
  proposalId,
  proposalName,
  signature,
  onShared,
  onGateError,
}: {
  open: boolean
  onClose: () => void
  proposalId: string
  proposalName: string
  signature: ProposalSignature | null
  /** Called after a link is created or replaced; the editor refetches. */
  onShared: () => Promise<void> | void
  /** A send-gate refusal. The editor decides which upgrade copy to show. */
  onGateError: (err: unknown) => void
}) {
  const [share, setShare] = useState<ProposalShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'create' | 'regen' | 'revoke' | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    getProposalShare(proposalId)
      .then((s) => {
        if (!cancelled) setShare(s)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Couldn't load the link.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, proposalId])

  const live = share !== null && shareIsLive(share)
  const url = share && live ? shareUrl(share.token) : null

  const create = useCallback(
    async (mode: 'create' | 'regen') => {
      setBusy(mode)
      setConfirmRegen(false)
      try {
        const s = await createProposalShare(proposalId)
        setShare(s)
        setCopied(false)
        await onShared()
        toast.success(mode === 'regen' ? 'New link ready. The old one no longer works.' : 'Link ready.')
      } catch (err) {
        if (isSendGateError(err) || isTrialSendGateError(err)) {
          onGateError(err)
        } else {
          toast.error(err instanceof Error ? err.message : "Couldn't create the link.")
        }
      } finally {
        setBusy(null)
      }
    },
    [proposalId, onShared, onGateError]
  )

  const revoke = useCallback(async () => {
    setBusy('revoke')
    try {
      await revokeProposalShare(proposalId)
      setShare((s) => (s ? { ...s, revoked_at: new Date().toISOString() } : s))
      toast.success('Link closed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close the link.")
    } finally {
      setBusy(null)
    }
  }, [proposalId])

  const copy = useCallback(async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }, [url])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="share-modal-title" className="text-lg font-bold text-gray-900">
              Share with client
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">{proposalName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* The client's answer */}
        {signature && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
              signature.decision === 'accepted'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            {signature.decision === 'accepted' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <p className="font-semibold">
                {signature.decision === 'accepted' ? 'Accepted' : 'Declined'} by {signature.signer_name}{' '}
                on {formatDate(signature.signed_at)}
              </p>
              {signature.decline_reason ? (
                <p className="mt-0.5 whitespace-pre-wrap">{signature.decline_reason}</p>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : share && live ? (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
                Client link
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={url ?? ''}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800"
                />
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
                >
                  {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {share.view_count > 0
                  ? `Opened ${share.view_count} ${share.view_count === 1 ? 'time' : 'times'}${
                      share.last_viewed_at ? `, last on ${formatDate(share.last_viewed_at)}` : ''
                    }.`
                  : 'Not opened yet.'}{' '}
                Expires {formatDate(share.expires_at)}.
              </p>
              <p className="mt-3 text-sm text-gray-700">
                Send this link however you talk to your client: text, email, or paste it
                into a message. They open it without an account, read the proposal, and
                accept it with a signature or decline it with a reason. You'll see their
                answer here and above the toolbar.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href={url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-4 w-4" />
                  Preview as client
                </a>
                {confirmRegen ? (
                  <span className="inline-flex items-center gap-2 text-sm text-gray-700">
                    The old link stops working.
                    <button
                      type="button"
                      onClick={() => void create('regen')}
                      disabled={busy !== null}
                      className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                    >
                      {busy === 'regen' ? 'Replacing…' : 'Replace it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRegen(false)}
                      className="text-sm font-medium text-gray-500 hover:text-gray-800"
                    >
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRegen(true)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    New link
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void revoke()}
                  disabled={busy !== null}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Close link
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                {share
                  ? share.revoked_at
                    ? 'The previous link is closed. Create a new one to share this proposal again.'
                    : 'The previous link has expired. Create a new one to share this proposal again.'
                  : 'Create a link your client can open without an account. They read the proposal, then accept it with a signature or decline it with a reason.'}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Sharing marks the proposal Sent. Links last 90 days and can be closed any time.
              </p>
              <button
                type="button"
                onClick={() => void create('create')}
                disabled={busy !== null}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
              >
                {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {busy === 'create' ? 'Creating…' : 'Create link'}
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
