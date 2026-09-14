import {createClient} from 'npm:@supabase/supabase-js@2.99.2'
import {createCrewclawReviewReceiver} from './handler.mjs'
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
const handle=createCrewclawReviewReceiver({secret:Deno.env.get('BIDCLAW_REVIEW_SHARED_SECRET')??'',
 projectOwner:async(id:string)=>{const {data,error}=await db.from('projects').select('user_id').eq('id',id).maybeSingle();if(error)throw error;return data?.user_id??null},
 upsert:async(row:any)=>{const current=await db.from('crewclaw_work_reviews').select('id,payload_hash,status').eq('workspace_id',row.workspace_id).eq('record_id',row.record_id).maybeSingle();if(current.error)throw current.error;if(current.data){if(current.data.payload_hash!==row.payload_hash)throw Error('changed');return current.data}const result=await db.from('crewclaw_work_reviews').insert(row).select('id,status').single();if(result.error)throw result.error;return result.data}
})
Deno.serve(async request=>{try{return await handle(request)}catch{return Response.json({error:'Review service unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}})
