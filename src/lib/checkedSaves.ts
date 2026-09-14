import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
export type EditableRow = {id:string;updated_at:string}
export type SaveIssue = {id:string;draft:Record<string,unknown>;message:string;latest?:Record<string,unknown>|null;loaded:boolean}
export async function conditionalSave<T extends EditableRow>(table:'work_areas'|'work_area_lines', row:T, patch:Partial<T>):Promise<T> {
 if(!row.updated_at) throw new Error('Reload this record before saving; its saved version is missing.')
 const {data,error}=await supabase.from(table).update(patch as never).eq('id',row.id).eq('updated_at',row.updated_at).select('*').maybeSingle()
 if(error) throw new Error(error.message)
 if(!data) throw new Error('This record changed or was deleted after you opened it. Your changes have not been saved.')
 return data as T
}
export function useCheckedSaves<T extends EditableRow>(table:'work_areas'|'work_area_lines') {
 const confirmed=useRef(new Map<string,T>())
 const queues=useRef(new Map<string,Promise<unknown>>())
 const blocked=useRef(new Set<string>())
 const [issues,setIssues]=useState<SaveIssue[]>([])
 function save(row:T,patch:Partial<T>):Promise<T|null> {
  const operation=(queues.current.get(row.id)??Promise.resolve()).then(async()=>{
   const base=confirmed.current.get(row.id)??row
   try{
    if(blocked.current.has(row.id))throw new Error('Compare and load the latest saved version before editing again.')
    const saved=await conditionalSave(table,base,patch);confirmed.current.set(row.id,saved);return saved
   }catch(e){blocked.current.add(row.id);setIssues(previous=>{
    const existing=previous.find(i=>i.id===row.id)
    return [...previous.filter(i=>i.id!==row.id),{id:row.id,draft:{...existing?.draft,...patch},message:e instanceof Error?e.message:'Save failed.',loaded:false}]
   });return null}
  });queues.current.set(row.id,operation);return operation
 }
 async function loadLatest(id:string):Promise<T|null|undefined>{
  await queues.current.get(id)
  const {data,error}=await supabase.from(table).select('*').eq('id',id).maybeSingle()
  if(error){setIssues(p=>p.map(i=>i.id===id?{...i,message:error.message}:i));return undefined}
  const latest=data as T|null
  if(latest)confirmed.current.set(id,latest);else confirmed.current.delete(id)
  blocked.current.delete(id)
  setIssues(p=>p.map(i=>i.id===id?{...i,latest:latest as unknown as Record<string,unknown>|null,loaded:true}:i))
  return latest
 }
 return {save,issues,loadLatest,dismiss:(id:string)=>setIssues(p=>p.filter(i=>i.id!==id))}
}
