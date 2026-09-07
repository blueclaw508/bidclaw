import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Link2, Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  disconnectQbo,
  loadQboMappings,
  qboStatus,
  saveQboMapping,
  startQboConnect,
  QboFunctionError,
  type QboMapping,
  type QboMappingCategory,
  type QboStatus,
} from '@/lib/qbo'
import { formatDateOnly } from '@/lib/invoiceStatus'

/**
 * Settings → QuickBooks. Connect (Intuit OAuth), see what is connected,
 * pick the service item invoice lines post to, disconnect. The WIP
 * account mapping (step 4) lands on this card when that ships; the
 * account list is already fetched for it.
 */
export function QuickBooksCard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<QboStatus | null>(null)
  const [mappings, setMappings] = useState<Partial<Record<QboMappingCategory, QboMapping>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'map' | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([qboStatus(), loadQboMappings()])
      setStatus(s)
      setMappings(m)
      setError(null)
    } catch (err) {
      setStatus({ connected: false })
      setError(err instanceof Error ? err.message : 'Could not reach QuickBooks.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Returning from Intuit: qbo-callback appends ?qbo=connected or
  // ?qbo=error&reason=… to the return path.
  useEffect(() => {
    const result = searchParams.get('qbo')
    if (!result) return
    if (result === 'connected') toast.success('QuickBooks connected.')
    else toast.error(searchParams.get('reason') || 'QuickBooks connection failed.')
    const next = new URLSearchParams(searchParams)
    next.delete('qbo')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const connect = async () => {
    setBusy('connect')
    try {
      await startQboConnect('/app/settings')
      // The browser is leaving; nothing more to do here.
    } catch (err) {
      setBusy(null)
      if (err instanceof QboFunctionError && err.code === 'NOT_CONFIGURED') {
        toast.error("QuickBooks isn't configured on the server yet.")
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't start the connection.")
      }
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    try {
      await disconnectQbo()
      toast.success('QuickBooks disconnected.')
      setConfirmDisconnect(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect.")
    } finally {
      setBusy(null)
    }
  }

  const setBillingItem = async (id: string) => {
    const item = status?.items?.find((i) => i.id === id)
    setBusy('map')
    try {
      await saveQboMapping('billing', { qbo_item_id: item?.id ?? null, qbo_item_name: item?.name ?? null })
      setMappings((m) => ({
        ...m,
        billing: {
          item_category: 'billing',
          qbo_account_id: m.billing?.qbo_account_id ?? null,
          qbo_account_name: m.billing?.qbo_account_name ?? null,
          qbo_item_id: item?.id ?? null,
          qbo_item_name: item?.name ?? null,
        },
      }))
      toast.success(item ? `Invoice lines will post to “${item.name}”.` : 'Mapping cleared.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-gray-900">QuickBooks Online</h2>
          <p className="mt-1 text-sm text-gray-500">
            Connect your own QuickBooks company. Invoices and payments post there when you send them;
            the WIP journal entry follows in the next step.
          </p>
        </div>
        {status === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : status.connected ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#2CA01C] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#248a17] disabled:opacity-50"
          >
            {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect to QuickBooks
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>
      )}

      {status?.connected && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Connected to {status.company_name || `company ${status.realm_id}`}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                status.environment === 'production'
                  ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
                  : 'bg-amber-100 text-amber-800 ring-amber-200'
              }`}
            >
              {status.environment === 'production' ? 'Production' : 'Sandbox'}
            </span>
            {status.connected_at && (
              <span className="text-xs text-gray-500">since {formatDateOnly(status.connected_at)}</span>
            )}
            {status.last_sync_at && (
              <span className="text-xs text-gray-500">last sync {formatDateOnly(status.last_sync_at)}</span>
            )}
          </div>
          {status.last_error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              Last error: {status.last_error}
            </p>
          )}

          <div className="max-w-md">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Invoice lines post to
            </label>
            <select
              value={mappings.billing?.qbo_item_id ?? ''}
              onChange={(e) => void setBillingItem(e.target.value)}
              disabled={busy === 'map'}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            >
              <option value="">Choose a service item…</option>
              {(status.items ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              A progress-billing line is a slice of a whole work area, so one service item carries every
              line. Most contractors use one called “Contract billing” or “Construction services”; make it in
              QuickBooks under Products &amp; services if you don't have one.
            </p>
          </div>
        </div>
      )}

      {status && !status.connected && !error && (
        <p className="mt-4 text-xs text-gray-500">
          You'll be sent to Intuit to sign in and pick the company. BidClaw keeps a connection token,
          encrypted, and nothing else from your books.
        </p>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
        title="Disconnect QuickBooks?"
        description="Invoices already in QuickBooks stay there. BidClaw forgets the connection and stops posting until you connect again."
        confirmLabel="Disconnect"
        tone="danger"
      />
    </section>
  )
}
