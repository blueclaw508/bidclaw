import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Row = {id:string;name:string;status:string;proposals:{id:string;name:string;status:string}[]}

export default function WorkOrders() {
  const {user} = useAuth()
  const [rows,setRows] = useState<Row[]>([])
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [search,setSearch] = useState('')
  useEffect(()=>{
    if(!user) return
    let cancelled=false
    void supabase.from('projects').select('id,name,status,proposals(id,name,status)').eq('user_id',user.id).neq('status','archived').order('name').then(({data,error})=>{
      if(cancelled)return
      setError(error?.message??'');setRows((data??[]) as Row[]);setLoading(false)
    })
    return ()=>{cancelled=true}
  },[user])
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold text-brand-navy">Work Orders</h1><p className="mt-2 text-brand-text-muted">Open a proposal’s crew planner to print quantities, planned hours and work instructions in English or Spanish. Use Crew Schedule to plan approved work orders.</p></header>
    <a className="inline-block rounded border border-brand-border bg-white px-4 py-3 font-semibold text-brand-navy" href="https://crewclaw.netlify.app/setup.html" target="_blank" rel="noopener noreferrer">Open CrewClaw job assignments ↗</a>
    <label className="block">Find a project<input type="search" value={search} onChange={e=>setSearch(e.target.value)} className="mt-1 block w-full rounded border border-brand-border p-3"/></label>
    {loading ? <p role="status">Loading work orders…</p> : error ? <p role="alert">Couldn’t load projects: {error}</p> : <>
      {rows.filter(row=>row.name.toLowerCase().includes(search.toLowerCase())).map(row=><section key={row.id} className="rounded-xl border border-brand-border bg-white p-5">
        <h2 className="text-lg font-bold"><Link to={`/app/projects/${row.id}?tab=work_areas`}>{row.name}</Link></h2>
        {row.proposals.length ? <ul className="mt-3 space-y-3">{row.proposals.map(proposal=><li key={proposal.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-border pt-3"><span>{proposal.name} <span className="text-brand-text-muted">({proposal.status})</span></span>{proposal.status==='approved'&&<Link className="font-semibold underline" to={`/app/crew-schedule?proposal=${proposal.id}`}>Schedule work order</Link>}<Link className="font-semibold text-brand-navy underline" to={`/app/projects/${row.id}/proposals/${proposal.id}/print?format=crew`}>Open crew planner</Link></li>)}</ul> : <p className="mt-2 text-brand-text-muted">No proposal available for printing yet. <Link className="underline" to={`/app/projects/${row.id}?tab=proposals`}>Open proposals</Link></p>}
      </section>)}
      {!rows.some(row=>row.name.toLowerCase().includes(search.toLowerCase())) &&<p>No matching active projects.</p>}
    </>}
  </div>
}

