import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

type Member = { id: string; email: string; active: boolean; created_at: string }
const input = 'w-full rounded border border-gray-300 bg-white p-3'
const button = 'rounded bg-brand-navy px-4 py-3 font-semibold text-white disabled:opacity-50'
export default function PeopleAccess() {
  const { user, workspaceOwnerId, isWorkspaceOwner } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const saving = useRef(false)
  async function load() {
    const { data, error } = await supabase.from('company_admin_members' as never)
      .select('id,email,active,created_at').order('email')
    if (error) throw new Error(error.message)
    setMembers((data ?? []) as Member[])
  }
  useEffect(() => {
    let live = true
    void load().catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [workspaceOwnerId])
  async function save(address: string, active: boolean) {
    if (saving.current || !isWorkspaceOwner) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const { error } = await supabase.rpc('manage_company_admin' as never, { p_email: address.trim().toLowerCase(), p_active: active } as never)
      if (error) throw new Error(error.message)
      await load()
      setEmail('')
      setNotice(active
        ? `${address} now has administrator access. They can open bluebidclaw.app and request a sign-in link using this email. No invitation email has been sent.`
        : `${address} no longer has access to this company. Existing company work is retained.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save access. Please retry.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <div className="space-y-6 max-w-4xl">
    <header><h1 className="text-2xl font-bold">People &amp; Access</h1>
      <p className="mt-2 text-gray-600">Each administrator uses their own login to work with the company’s customers, estimates, proposals, files, schedule and reports.</p></header>
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4">{error}</p>}
    {notice && <p role="status" className="rounded border border-green-300 bg-green-50 p-4">{notice}</p>}
    {isWorkspaceOwner ? <section className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="text-lg font-bold">Add administrator</h2>
      <p>Administrators can create, edit, send and delete company work. Only you, the owner, can manage access, billing and connections.</p>
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e => { e.preventDefault(); void save(email, true) }}>
        <label className="flex-1">Email address<input className={input} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
        <button className={button} disabled={busy || loading} type="submit">{busy ? 'Saving…' : 'Add administrator'}</button>
      </form>
      <p className="text-sm text-gray-600">After you add them, they verify their email through BidClaw’s sign-in link. You do not need to set or share a password.</p>
    </section> : <p className="rounded bg-blue-50 p-4">The company owner manages administrator access.</p>}
    <section className="rounded-xl border bg-white p-5 space-y-4">
      <h2 className="text-lg font-bold">Company access</h2>
      <p className="border-b pb-3">{isWorkspaceOwner ? user?.email : 'Company owner'} <strong>— Owner</strong></p>
      {loading ? <p>Loading administrators…</p> : members.length === 0 ? <p>No additional administrators yet.</p> : members.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div><p className="break-all font-semibold">{m.email}</p><p className="text-sm text-gray-600">Administrator · {m.active ? 'Access enabled' : 'Access revoked'}</p></div>
        {isWorkspaceOwner && <button className="rounded border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => {
          if (m.active && !window.confirm(`Revoke ${m.email}’s access to this company? Their work will remain.`)) return
          void save(m.email, !m.active)
        }}>{m.active ? 'Revoke access' : 'Restore access'}</button>}
      </div>)}
    </section>
  </div>
}
