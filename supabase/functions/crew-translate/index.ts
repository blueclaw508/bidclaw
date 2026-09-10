import {createClient} from 'npm:@supabase/supabase-js@2'
import {protectNumbers, restoreNumbers, TRANSLATION_RULES} from './policy.ts'

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,'Content-Type':'application/json'}})

Deno.serve(async req => {
  if(req.method === 'OPTIONS') return new Response('ok',{headers:cors})
  if(req.method !== 'POST') return json({error:'Use POST.'},405)
  const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')??''}}})
  const {data:{user}} = await client.auth.getUser()
  if(!user) return json({error:'Sign in to prepare a crew planner.'},401)
  let body: {proposalId:string; texts:Record<string,string>}
  try {
    const raw = await req.text()
    if(raw.length > 70000) return json({error:'Crew planner is too long. Prepare fewer work areas at once.'},400)
    body = JSON.parse(raw)
    if(!body.proposalId || !body.texts || Array.isArray(body.texts) || typeof body.texts !== 'object' || Object.keys(body.texts).length > 500 || !Object.values(body.texts).every(v=>typeof v === 'string' && v.trim())) throw new Error()
  } catch {return json({error:'Invalid crew planner request.'},400)}
  // RLS checks ownership. This endpoint never updates any proposal or estimate.
  const {data:proposal} = await client.from('proposals').select('id').eq('id',body.proposalId).maybeSingle()
  if(!proposal) return json({error:'Proposal not found.'},404)
  const key = Deno.env.get('GEMINI_API_KEY')
  if(!key) return json({error:'Spanish crew translation is not connected. Contact your administrator.'},503)
  try {
    const protectedTexts = Object.fromEntries(Object.entries(body.texts).map(([id,text])=>[id,protectNumbers(text)]))
    const input = Object.fromEntries(Object.entries(protectedTexts).map(([id,value])=>[id,value.masked]))
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',signal:AbortSignal.timeout(90_000),headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
      body:JSON.stringify({model:Deno.env.get('GEMINI_MEDIA_MODEL')||'gemini-3.8-flash',store:false,input:[{type:'text',text:TRANSLATION_RULES+'\nSOURCE JSON:\n'+JSON.stringify(input)}]})
    })
    if(!response.ok) throw new Error('Translation service is unavailable. Please retry.')
    const result = await response.json()
    const output = (result.steps??[]).filter((s:any)=>s.type==='model_output').flatMap((s:any)=>s.content??[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')
    if(result.status!=='completed') throw new Error('Translation did not finish. Please retry.')
    const translated = JSON.parse(output.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
    if(!translated || Array.isArray(translated) || Object.keys(translated).length !== Object.keys(input).length) throw new Error('Incomplete translation. Please retry.')
    const texts = Object.fromEntries(Object.entries(protectedTexts).map(([id,value])=>[id,restoreNumbers(translated[id],value.values)]))
    return json({texts})
  } catch(err) { return json({error:err instanceof Error && !/JSON/.test(err.message) ? err.message : 'Could not translate the crew planner. Please retry.'},502) }
})
