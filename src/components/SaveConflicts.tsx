import type { SaveIssue } from '@/lib/checkedSaves'
const text=(value:unknown)=>value==null?'—':typeof value==='object'?JSON.stringify(value,null,2):String(value)
export function SaveConflicts({issues,onLoad,onDismiss}:{issues:SaveIssue[];onLoad:(id:string)=>Promise<void>;onDismiss:(id:string)=>void}) {
 return <>{issues.map(issue=><section key={issue.id} role="alert" className="m-3 space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4">
  <h3 className="font-bold">Unsaved changes — review before saving</h3><p>{issue.message}</p>
  <p className="text-sm">Your attempted changes are kept below. Load the latest version, compare, then enter any changes you still want. Nothing is overwritten automatically.</p>
  <div className="grid gap-3 sm:grid-cols-2"><label>Your unsaved changes<textarea readOnly rows={5} className="mt-1 w-full rounded border bg-white p-2" value={Object.entries(issue.draft).map(([k,v])=>`${k.replaceAll('_',' ')}: ${text(v)}`).join('\n')}/></label>{issue.loaded&&<label>Latest saved values<textarea readOnly rows={5} className="mt-1 w-full rounded border bg-white p-2" value={issue.latest?Object.keys(issue.draft).map(k=>`${k.replaceAll('_',' ')}: ${text(issue.latest?.[k])}`).join('\n'):'This record was deleted or is no longer accessible.'}/></label>}</div>
  <button type="button" className="rounded border bg-white px-3 py-2" onClick={()=>void onLoad(issue.id)}>Load latest version</button>{issue.loaded&&<button type="button" className="ml-3 rounded border bg-white px-3 py-2" onClick={()=>onDismiss(issue.id)}>Dismiss comparison</button>}
 </section>)}</>
}
