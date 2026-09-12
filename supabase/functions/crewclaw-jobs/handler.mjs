const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export const digest=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('')
export function createJobFeed({identity,store,now=()=>Date.now()}){
 return async request=>{
  const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if(!token)return reply(401,{error:'Sign in required'})
  if(request.method==='POST'){
   const user=await identity(token);if(!user)return reply(401,{error:'Sign in to BidClaw first'})
   let body;try{const text=await request.text();if(text.length>2000)throw Error();body=JSON.parse(text)}catch{return reply(400,{error:'Invalid connection request'})}
   if(!uuid(body.workspaceId)||!uuid(body.companyId))return reply(400,{error:'Invalid destination'})
   const secret='ccj_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),expiresAt=new Date(now()+15*60*1000).toISOString()
   await store.issue({token_hash:await digest(secret),user_id:user.id,workspace_id:body.workspaceId,company_id:body.companyId,expires_at:expiresAt})
   return reply(200,{token:secret,expiresAt})
  }
  if(request.method!=='GET')return reply(405,{error:'Use GET or POST'})
  if(!/^ccj_[0-9a-f]{64}$/.test(token))return reply(401,{error:'Reconnect BidClaw'})
  const grant=await store.grant(await digest(token))
  if(!grant||Date.parse(grant.expires_at)<=now())return reply(401,{error:'Connection expired; reconnect BidClaw'})
  const rows=await store.jobs(grant.user_id)
  if(rows.length>1000)return reply(409,{error:'Too many jobs for this import; contact support'})
  // Defense in depth: never expose another account, estimates, prices or proposal text.
  const jobs=rows.filter(p=>p.user_id===grant.user_id&&['approved','in_progress'].includes(p.status)).map(p=>({sourceId:p.id,name:p.name,status:p.status,address:p.site_address||[p.site_address_line1,p.site_address_city,p.site_address_state,p.site_address_zip].filter(Boolean).join(', ')}))
  return reply(200,{source:'bidclaw',sourceTenant:grant.user_id,workspaceId:grant.workspace_id,companyId:grant.company_id,jobs})
 }
}
