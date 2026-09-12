import {createClient} from 'npm:@supabase/supabase-js@2.99.2'
import {createJobFeed} from './handler.mjs'
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
const check=({data,error}:any)=>{if(error)throw error;return data}
const handle=createJobFeed({identity:async(token:string)=>{const {data,error}=await db.auth.getUser(token);return error?null:data.user},store:{
 issue:async(row:any)=>check(await db.from('crewclaw_job_tokens').insert(row)),
 grant:async(hash:string)=>check(await db.from('crewclaw_job_tokens').select('*').eq('token_hash',hash).maybeSingle()),
 jobs:async(user:string)=>check(await db.from('projects').select('id,user_id,name,status,site_address,site_address_line1,site_address_city,site_address_state,site_address_zip').eq('user_id',user).in('status',['approved','in_progress']).order('id').limit(1001))
}})
Deno.serve(async request=>{
 const origin=request.headers.get('origin');if(origin&&origin!=='https://bluebidclaw.app')return new Response('Origin not allowed',{status:403})
 const headers=new Headers({'Vary':'Origin','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'});if(origin)headers.set('Access-Control-Allow-Origin',origin)
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
 let response;try{response=await handle(request)}catch{response=Response.json({error:'BidClaw jobs are temporarily unavailable'},{status:503})}
 for(const [k,v] of headers)response.headers.set(k,v);return response
})
