import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type Review={id:string;project_id:string;work_date:string;progress:'ongoing'|'done';summary:string;time_entries:{employeeId:string;seconds:number;activity:string}[];materials:{description:string;quantity:number;unit:string}[];extras:{description:string}[];total_seconds:number;status:'needs_review'|'posted'|'rejected';manager_note:string;received_at:string;projects:{name:string}|null}
const hours=(seconds:number)=>`${(seconds/3600).toFixed(2)} hr`

export default function CrewReviewPage(){
 const [rows,setRows]=useState<Review[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[notes,setNotes]=useState<Record<string,string>>({})
 const load=useCallback(async()=>{setLoading(true);const {data,error}=await supabase.from('crewclaw_work_reviews').select('*, projects(name)').order('work_date',{ascending:false}).order('received_at',{ascending:false}).limit(250);setLoading(false);if(error)toast.error(`Couldn't load crew results: ${error.message}`);else setRows((data??[]) as Review[])},[])
 useEffect(()=>{void load()},[load])
 const decide=async(r:Review,decision:'posted'|'rejected')=>{setBusy(r.id);const {error}=await supabase.rpc('review_crewclaw_work',{p_review:r.id,p_decision:decision,p_note:notes[r.id]??''});setBusy(null);if(error)return toast.error(error.message);toast.success(decision==='posted'?'Daily result posted to the project.':'Daily result rejected.');void load()}
 return <div className="space-y-6">
  <header><h1 className="text-2xl font-bold text-brand-navy">CrewClaw Review</h1><p className="mt-1 text-sm text-brand-text-muted">Review daily field results before they become posted project execution records. Approved estimates and proposals are never changed here.</p></header>
  {loading?<p className="text-sm text-brand-text-muted">Loading daily results…</p>:rows.length===0?<section className="rounded-xl border border-brand-border bg-white p-8 text-center"><ClipboardCheck className="mx-auto h-8 w-8 text-brand-text-muted"/><h2 className="mt-3 font-bold">No crew results yet</h2><p className="mt-1 text-sm text-brand-text-muted">Approved BidClaw work from CrewClaw will appear here.</p></section>:
  <div className="space-y-4">{rows.map(r=><article key={r.id} className={`rounded-xl border bg-white p-5 shadow-sm ${r.status==='needs_review'?'border-amber-300':'border-brand-border'}`}>
   <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to={`/app/projects/${r.project_id}`} className="font-bold text-brand-navy underline">{r.projects?.name??'Project'}</Link><p className="text-sm text-brand-text-muted">{r.work_date} · {r.progress==='done'?'Marked done':'Ongoing'} · {hours(r.total_seconds)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.status==='needs_review'?'bg-amber-100 text-amber-800':r.status==='posted'?'bg-emerald-100 text-emerald-800':'bg-rose-100 text-rose-800'}`}>{r.status.replace('_',' ')}</span></div>
   {r.summary&&<p className="mt-4 whitespace-pre-wrap text-sm">{r.summary}</p>}
   <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><b>Labor</b><p>{r.time_entries.length} entries · {hours(r.total_seconds)}</p></div><div><b>Materials</b>{r.materials.length?r.materials.map((m,i)=><p key={i}>{m.description}: {m.quantity} {m.unit}</p>):<p>None</p>}</div><div><b>Extras needing pricing</b>{r.extras.length?r.extras.map((e,i)=><p key={i} className="font-semibold text-amber-800">{e.description}</p>):<p>None</p>}</div></div>
   {r.status==='needs_review'?<div className="mt-4 flex flex-col gap-3 border-t border-brand-border pt-4 sm:flex-row"><input value={notes[r.id]??''} onChange={e=>setNotes({...notes,[r.id]:e.target.value})} placeholder="Manager note (optional)" maxLength={2000} className="min-w-0 flex-1 rounded-md border border-brand-border px-3 py-2 text-sm"/><button disabled={busy===r.id} onClick={()=>void decide(r,'posted')} className="flex items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4"/>Post result</button><button disabled={busy===r.id} onClick={()=>void decide(r,'rejected')} className="flex items-center justify-center gap-2 rounded-md border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"><XCircle className="h-4 w-4"/>Reject</button></div>:r.manager_note&&<p className="mt-4 border-t border-brand-border pt-3 text-sm"><b>Manager note:</b> {r.manager_note}</p>}
  </article>)}</div>}
 </div>
}
