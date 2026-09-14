import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Activity = { id: number; actor_email: string | null; occurred_at: string; entity_type: string; entity_name: string; project_id: string | null; project_name: string | null; action: string; changes: Record<string, {before: unknown; after: unknown}> }
const labels: Record<string,string> = {projects:'Project',work_areas:'Work area',work_area_lines:'Estimate line',proposals:'Proposal',proposal_lines:'Proposal line',proposal_work_areas:'Proposal scope',construction_schedule:'Work order schedule',crewclaw_work_reviews:'Work review',company_admin_members:'Administrator access'}
const show = (v: unknown): string => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
const literal = (v: string) => v.replace(/[\\%_]/g, '\\$&')
const control = 'w-full rounded border border-gray-300 bg-white p-3'
export default function ActivityHistory() {
 const {workspaceOwnerId,isWorkspaceOwner} = useAuth()
 const [rows,setRows] = useState<Activity[]>([])
 const [busy,setBusy] = useState(false)
 const [error,setError] = useState('')
 const [more,setMore] = useState(false)
 const [filters,setFilters] = useState({person:'',project:'',action:'',type:''})
 const [applied,setApplied] = useState(filters)
 const request = useRef(0)
 async function load(append = false) {
  const ticket = ++request.current
  setBusy(true);setError('')
  try {
   let query = supabase.from('company_activity' as never).select('id,actor_email,occurred_at,entity_type,entity_name,project_id,project_name,action,changes').order('id',{ascending:false}).limit(51)
   if(applied.person.trim()) query=query.ilike('actor_email',`%${literal(applied.person.trim())}%`)
   if(applied.project.trim()) query=query.ilike('project_name',`%${literal(applied.project.trim())}%`)
   if(applied.action) query=query.eq('action',applied.action)
   if(applied.type) query=query.eq('entity_type',applied.type)
   if(append && rows.length) query=query.lt('id',rows[rows.length-1].id)
   const {data,error} = await query
   if(error) throw new Error(error.message)
   if(ticket!==request.current) return
   const received = (data??[]) as Activity[]
   setMore(received.length>50);setRows(previous=>append?[...previous,...received.slice(0,50)]:received.slice(0,50))
  } catch(e) { if(ticket===request.current) setError(e instanceof Error?e.message:'Could not load activity.') }
  finally {if(ticket===request.current)setBusy(false)}
 }
 useEffect(()=>{setRows([]);setMore(false);void load();return()=>{request.current++}},[workspaceOwnerId,applied])
 return <div className="space-y-5">
  <header><h1 className="text-2xl font-bold">Activity History</h1><p className="mt-2 text-gray-600">Who changed company work, when, and what changed. History begins when tracking was enabled.</p><p className="mt-1 text-sm text-gray-600">System or client means no signed-in staff identity was available. Times use your local time zone. {isWorkspaceOwner?'Administrator access changes are visible only to you.':''}</p></header>
  <form className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e=>{e.preventDefault();setApplied({...filters})}}>
   <label>Employee email<input className={control} value={filters.person} onChange={e=>setFilters({...filters,person:e.target.value})} placeholder="All employees" /></label>
   <label>Project name<input className={control} value={filters.project} onChange={e=>setFilters({...filters,project:e.target.value})} placeholder="All projects" /></label>
   <label>Activity<select className={control} value={filters.action} onChange={e=>setFilters({...filters,action:e.target.value})}><option value="">All activities</option><option value="created">Created</option><option value="updated">Updated</option><option value="deleted">Deleted</option></select></label>
   <label>Record type<select className={control} value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">All records</option>{Object.entries(labels).filter(([k])=>isWorkspaceOwner||k!=='company_admin_members').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <button className="self-end rounded bg-brand-navy px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy}>{busy?'Loading…':'Apply / Refresh'}</button>
  </form>
  {error&&<p role="alert" className="rounded bg-red-50 p-4 text-red-700">{error} Use Apply / Refresh to retry.</p>}
  {!busy&&!error&&rows.length===0&&<p className="rounded-xl border bg-white p-6">No activity matches these filters. New changes will appear here after they are saved.</p>}
  <div className="space-y-3" aria-live="polite">{rows.map(row=><article key={row.id} className="rounded-xl border bg-white p-4">
   <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold break-words">{row.actor_email||'System or client'} · {row.action} {labels[row.entity_type]||row.entity_type}</p><time dateTime={row.occurred_at} className="text-sm text-gray-600">{new Date(row.occurred_at).toLocaleString()}</time></div>
   <p className="mt-1 break-words">{row.entity_name}</p>{row.project_name&&<p className="text-sm text-gray-600">Project: {row.project_name}</p>}
   <details className="mt-3"><summary className="cursor-pointer font-semibold text-brand-navy">View changes ({Object.keys(row.changes).length})</summary><div className="mt-3 space-y-3">{Object.entries(row.changes).map(([field,change])=><div key={field} className="rounded bg-gray-50 p-3"><p className="font-semibold capitalize">{field.replaceAll('_',' ')}</p><div className="mt-2 grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-gray-500">Before</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{show(change.before)}</pre></div><div><p className="text-xs font-semibold uppercase text-gray-500">After</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{show(change.after)}</pre></div></div></div>)}</div></details>
  </article>)}</div>
  {more&&<button disabled={busy} className="rounded border bg-white px-5 py-3 disabled:opacity-50" onClick={()=>void load(true)}>{busy?'Loading…':'Load older activity'}</button>}
  <p className="text-sm text-gray-600">This history is read-only. <Link className="underline" to="/app/projects">Return to estimates and proposals</Link></p>
 </div>
}
