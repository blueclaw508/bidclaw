import {useEffect,useState} from 'react'
import {toast} from 'sonner'
import {supabase} from '@/lib/supabase'
import {ConfirmDialog} from '@/components/ConfirmDialog'
type Contact={id:string;slot:number;name:string;role:string;company:string;phone:string;email:string}
const blank={name:'',role:'',company:'',phone:'',email:''}
export function LeadContacts({leadId}:{leadId:string}) {
 const [rows,setRows]=useState<Contact[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState('')
 const [draft,setDraft]=useState<typeof blank|null>(null),[editId,setEditId]=useState<string|null>(null),[busy,setBusy]=useState(false),[remove,setRemove]=useState<Contact|null>(null)
 async function load(){setLoaded(false);const {data,error}=await supabase.from('lead_contacts').select('*').eq('lead_id',leadId).order('slot');if(error)setError(error.message);else{setRows(data??[]);setError('');setLoaded(true)}}
 useEffect(()=>{void load()},[leadId])
 async function save(e:React.FormEvent){e.preventDefault();if(!draft||busy)return;setBusy(true);try{
  const values=Object.fromEntries(Object.entries(draft).map(([k,v])=>[k,v.trim()]))
  const slot=Array.from({length:10},(_,i)=>i+1).find(s=>!rows.some(r=>r.slot===s))
  if(!editId&&!slot)throw new Error('This lead already has ten additional contacts.')
  const query=editId ? supabase.from('lead_contacts').update(values).eq('id',editId).eq('lead_id',leadId) : supabase.from('lead_contacts').insert({...values,lead_id:leadId,slot})
  const {error}=await query.select('id').single();if(error)throw new Error(error.code==='23505'?'Another contact was just added. Cancel, refresh, and try again.':error.message)
  setDraft(null);setEditId(null);await load();toast.success('Contact saved.')
 }catch(e){toast.error(e instanceof Error?e.message:'Could not save contact.')}finally{setBusy(false)}}
 return <section className="rounded-xl border border-brand-border bg-white p-5 shadow-sm">
  <div className="flex items-center justify-between gap-3"><h2 className="font-bold">Additional contacts ({rows.length}/10)</h2><button type="button" disabled={!loaded||rows.length>=10||!!draft} onClick={()=>{setEditId(null);setDraft({...blank})}} className="rounded bg-brand-navy px-3 py-2 text-white disabled:opacity-40">Add contact</button></div>
  <p className="mt-2 text-sm text-gray-500">Project contacts in addition to the primary customer. Adding a contact does not invite them to BidClaw.</p>
  {error&&<p role="alert">{error} <button onClick={()=>void load()} className="underline">Retry</button></p>}
  {!loaded&&!error&&<p>Loading contacts…</p>}
  <ul className="mt-3 space-y-3">{rows.map(c=><li key={c.id} className="rounded border p-3"><strong>{c.name}</strong><p>{[c.role,c.company].filter(Boolean).join(' · ')}</p><p>{c.phone}</p><p className="break-all">{c.email}</p><div className="mt-2 flex gap-4"><button disabled={!!draft} className="text-blue-700 underline disabled:opacity-40" onClick={()=>{setEditId(c.id);setDraft({name:c.name,role:c.role,company:c.company,phone:c.phone,email:c.email})}}>Edit</button><button disabled={!!draft} className="text-red-700 underline disabled:opacity-40" onClick={()=>setRemove(c)}>Remove</button></div></li>)}</ul>
  {draft&&<form onSubmit={save} className="mt-4 grid gap-3 rounded border p-3 sm:grid-cols-2">{(Object.keys(blank) as Array<keyof typeof blank>).map(field=><label key={field} className="capitalize">{field}{field==='name'?' *':''}<input required={field==='name'} type={field==='email'?'email':field==='phone'?'tel':'text'} maxLength={field==='email'?254:field==='phone'?80:200} value={draft[field]} onChange={e=>setDraft({...draft,[field]:e.target.value})} className="mt-1 w-full rounded border p-2"/></label>)}<div className="flex items-end gap-3"><button disabled={busy||!draft.name.trim()} className="rounded bg-brand-navy px-3 py-2 text-white disabled:opacity-40">{busy?'Saving…':'Save contact'}</button><button type="button" disabled={busy} onClick={()=>{setDraft(null);setEditId(null)}}>Cancel</button></div></form>}
  <ConfirmDialog open={!!remove} onClose={()=>setRemove(null)} title="Remove contact?" description={`Remove ${remove?.name??''} from this project’s additional contacts?`} confirmLabel="Remove contact" tone="danger" onConfirm={async()=>{if(!remove)return;const {error}=await supabase.from('lead_contacts').delete().eq('id',remove.id).eq('lead_id',leadId).select('id').single();if(error){toast.error(error.message);return}setRemove(null);await load();toast.success('Contact removed.')}}/>
 </section>
}
