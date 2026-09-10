import {createClient} from 'npm:@supabase/supabase-js@2'
import {mediaMime, needsMediaReview, VIDEO_LIMIT, WALKTHROUGH_PROMPT} from '../_shared/mediaPolicy.ts'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const ROOT='https://generativelanguage.googleapis.com'

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'Use POST.'},405)
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')??''}}})
  const {data:{user}}=await client.auth.getUser()
  if(!user) return json({error:'Sign in before preparing a walkthrough.'},401)
  let fileId:string
  try {fileId=(await req.json()).fileId} catch {return json({error:'Invalid request.'},400)}
  // RLS verifies project ownership before any privileged read or provider call.
  const {data:file}=await client.from('project_files').select('*').eq('id',fileId).single()
  if(!file) return json({error:'File not found.'},404)
  if(!file.storage_path.startsWith(`${user.id}/${file.project_id}/`)) return json({error:'File storage location does not match this project.'},403)
  const {data:settings}=await client.from('company_settings').select('jamie_enabled').single()
  if(!settings?.jamie_enabled) return json({error:'Jamie must be enabled to review walkthroughs.'},403)
  if(!needsMediaReview(file.mime_type,file.file_name)) return json({error:'Jamie reads this format directly.'},400)
  if(file.media_status==='ready' && file.media_notes) return json({status:'ready'})
  if(!file.file_size_bytes || file.file_size_bytes>VIDEO_LIMIT) return json({error:'Use a clip under 250 MB.'},400)
  const key=Deno.env.get('GEMINI_API_KEY')
  if(!key) return json({error:'Video review is not connected yet. The account administrator must connect Gemini in Supabase.'},503)
  const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cutoff=new Date(Date.now()-5*60_000).toISOString()
  // One active review per file. Interrupted requests become retryable after five minutes.
  const {data:claimed,error:claimError}=await service.from('project_files').update({media_status:'processing',media_error:null,media_started_at:new Date().toISOString()})
    .eq('id',file.id).or(`media_status.is.null,media_status.neq.processing,media_started_at.lt.${cutoff}`).select('id')
  if(claimError) return json({error:'Could not start media review.'},500)
  if(!claimed?.length) return json({status:'processing'},202)
  const signal=AbortSignal.timeout(210_000)
  const api=async(path:string,init:RequestInit={})=>{
    const r=await fetch(ROOT+path,{...init,signal,headers:{'x-goog-api-key':key,...init.headers}})
    if(!r.ok) throw new Error(`Video service returned ${r.status}. Check the Gemini connection or retry.`)
    return r
  }
  let providerName:string|null=file.media_provider_file
  const save=async(values:Record<string,unknown>)=>{
    const {error}=await service.from('project_files').update(values).eq('id',file.id)
    if(error) throw new Error('Could not save the walkthrough review.')
  }
  try {
    let remote:any=null
    if(providerName && /^files\/[a-zA-Z0-9_-]+$/.test(providerName)) {
      const r=await fetch(ROOT+'/v1beta/'+providerName,{headers:{'x-goog-api-key':key},signal})
      if(r.ok) remote=await r.json()
      else if(r.status!==404) throw new Error(`Video service returned ${r.status}. Retry later.`)
    }
    const mime=mediaMime(file.mime_type,file.file_name)
    if(!remote) {
      const start=await api('/upload/v1beta/files',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':String(file.file_size_bytes),'X-Goog-Upload-Header-Content-Type':mime},body:JSON.stringify({file:{display_name:file.file_name}})})
      const uploadUrl=start.headers.get('x-goog-upload-url')
      if(!uploadUrl || new URL(uploadUrl).hostname!=='generativelanguage.googleapis.com') throw new Error('Video upload could not start.')
      const {data:signed,error}=await service.storage.from('project-files').createSignedUrl(file.storage_path,300)
      if(error || !signed?.signedUrl) throw new Error('Could not read the stored walkthrough.')
      const source=await fetch(signed.signedUrl,{signal})
      if(!source.ok || !source.body) throw new Error('Could not read the stored walkthrough.')
      // Stream original bytes; do not buffer a phone video into edge-function memory.
      const uploaded=await fetch(uploadUrl,{method:'POST',signal,headers:{'X-Goog-Upload-Offset':'0','X-Goog-Upload-Command':'upload, finalize'},body:source.body})
      if(!uploaded.ok) throw new Error('Video transfer failed. Retry preparing this file.')
      remote=(await uploaded.json()).file
      providerName=remote?.name
      if(!providerName || !/^files\/[a-zA-Z0-9_-]+$/.test(providerName)) throw new Error('Video service returned no file.')
      await save({media_provider_file:providerName})
    }
    const waitUntil=Date.now()+60_000
    while(remote.state==='PROCESSING' && Date.now()<waitUntil) {
      await new Promise(resolve=>setTimeout(resolve,3000))
      remote=await (await api('/v1beta/'+providerName)).json()
    }
    if(remote.state!=='ACTIVE') throw new Error(remote.state==='PROCESSING'?'The video is still processing. Click Prepare for Jamie again shortly.':'This video could not be decoded. Export as MP4 with H.264 video and AAC audio, then upload again.')
    const response=await api('/v1beta/interactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:Deno.env.get('GEMINI_MEDIA_MODEL')||'gemini-3.8-flash',store:false,input:[{type:'text',text:WALKTHROUGH_PROMPT},{type:mime.startsWith('video/')?'video':'image',uri:remote.uri,mime_type:mime}]})})
    const result=await response.json()
    const notes=(result.steps??[]).filter((s:any)=>s.type==='model_output').flatMap((s:any)=>s.content??[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')
    if(result.status!=='completed' || !notes.trim() || notes.length>30000) throw new Error('The walkthrough review was incomplete. Retry or use a shorter clip.')
    await save({media_status:'ready',media_notes:notes,media_error:null,anthropic_sync_error:null,media_provider_file:null})
    // Only original private storage and the review notes are retained by BidClaw.
    await api('/v1beta/'+providerName,{method:'DELETE'}).catch(()=>{})
    return json({status:'ready'})
  } catch(err) {
    const message=signal.aborted?'Video review timed out. Retry or upload a shorter clip.':err instanceof Error?err.message:'Could not review the walkthrough.'
    await save({media_status:'error',media_error:message}).catch(()=>{})
    return json({error:message},502)
  }
})
