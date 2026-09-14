const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const text=(v,n)=>typeof v==='string'&&v.length<=n?v:null
export const hashPayload=async body=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('')
export function createCrewclawReviewReceiver({secret,projectOwner,upsert}){
 return async request=>{
  const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
  if(request.method!=='POST')return reply(405,{error:'Use POST'})
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if(!secret||token!==secret)return reply(401,{error:'Not authorized'})
  let raw,body;try{raw=await request.text();if(raw.length>65536)throw Error();body=JSON.parse(raw)}catch{return reply(400,{error:'Invalid work record'})}
  if(body?.source!=='bidclaw'||!uuid(body.sourceTenant)||!uuid(body.workspaceId)||!uuid(body.recordId)||!uuid(body.jobId)||!/^\d{4}-\d{2}-\d{2}$/.test(body.workDate)||!['ongoing','done'].includes(body.progress)||text(body.summary,4000)===null||!Array.isArray(body.time)||!Array.isArray(body.materials)||!Array.isArray(body.extras)||body.time.length>100||body.materials.length>100||body.extras.length>100)return reply(400,{error:'Invalid work record'})
  if(!body.time.every(t=>uuid(t.employeeId)&&text(t.startedAt,40)!==null&&text(t.endedAt,40)!==null&&Number.isSafeInteger(t.seconds)&&t.seconds>=0&&t.seconds<=86400&&['job','travel','shop','paid_break','unpaid_break'].includes(t.activity))||!body.materials.every(m=>text(m.description,500)!==null&&Number.isFinite(m.quantity)&&m.quantity>0&&text(m.unit,50)!==null)||!body.extras.every(e=>text(e.kind,50)!==null&&text(e.description,1000)!==null))return reply(400,{error:'Invalid work details'})
  if(await projectOwner(body.jobId)!==body.sourceTenant)return reply(404,{error:'Project unavailable'})
  const row={user_id:body.sourceTenant,project_id:body.jobId,workspace_id:body.workspaceId,record_id:body.recordId,work_date:body.workDate,progress:body.progress,summary:body.summary,time_entries:body.time,materials:body.materials,extras:body.extras,total_seconds:body.time.filter(t=>t.activity!=='unpaid_break').reduce((n,t)=>n+t.seconds,0),submitted_by:uuid(body.submittedBy)?body.submittedBy:null,submitted_at:text(body.submittedAt,40),crewclaw_approved_by:uuid(body.approvedBy)?body.approvedBy:null,crewclaw_approved_at:text(body.approvedAt,40),payload_hash:await hashPayload(raw)}
  try{const saved=await upsert(row);return reply(200,{id:saved.id,status:saved.status})}catch(e){return reply(409,{error:e?.message==='changed'?'A changed copy of this approved record already exists':'Work record could not be saved'})}
 }
}
