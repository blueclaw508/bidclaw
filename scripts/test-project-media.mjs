import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {mediaMime,needsMediaReview,VIDEO_LIMIT,MEDIA_EVIDENCE_RULES,WALKTHROUGH_PROMPT} from '../supabase/functions/_shared/mediaPolicy.ts'
import {bulletScope} from '../supabase/functions/_shared/scopeFormat.ts'
import {orderedConcurrentMap} from '../supabase/functions/_shared/jamiePerformance.ts'
const load=(file,context)=>{
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context)
}
assert.equal(mediaMime('', 'walk.MOV'),'video/quicktime')
assert.equal(needsMediaReview('', 'walk.mp4'),true)
assert.equal(needsMediaReview('image/heic','photo.heic'),true)
assert.equal(needsMediaReview('image/jpeg','photo.jpg'),false)
assert.equal(bulletScope('Relay 40.5 SF of stone. Leave spoil on site.'),'- Relay 40.5 SF of stone.\n- Leave spoil on site.')
assert.equal(bulletScope('- Lift stone\n- Relay it'),'- Lift stone\n- Relay it')
let rows=[{id:'photo',file_name:'site.JPG',storage_path:'owner/project/site.JPG',mime_type:null,anthropic_file_id:'photo-ref'}, {id:'video',file_name:'walk.mov',storage_path:'owner/project/walk.mov',media_status:'ready',media_notes:'00:04 Speaker requests joint repair; no area given.'}]
const service={from:table=>({select(){return this},eq(){return this},order:async()=>({data:rows}),single:async()=>({data:{user_id:'owner'}})})}
const ctx=vm.createContext({orderedConcurrentMap,mediaMime,needsMediaReview,MEDIA_EVIDENCE_RULES})
load('../supabase/functions/_shared/projectFiles.ts',ctx)
let synced=await ctx.syncProjectFiles(service,{},'project')
const blocks=ctx.fileBlocks(synced)
assert.equal(blocks[0].type,'image');assert.equal(blocks[0].source.file_id,'photo-ref')
assert.match(blocks[1].text,/00:04 Speaker requests joint repair/)
assert.equal((await ctx.syncProjectFiles(service,{},'project',['photo'])).length,1)
assert.equal((await ctx.syncProjectFiles(service,{},'project',[])).length,0)
await assert.rejects(ctx.syncProjectFiles(service,{},'project',['another-project-file']),/no longer on this project/)
rows[1].media_status=null
await assert.rejects(ctx.syncProjectFiles(service,{},'project'),/Prepare these files/)
rows[0].storage_path='other-owner/private.jpg'
await assert.rejects(ctx.syncProjectFiles(service,{},'project',['photo']),/storage could not be verified/)

// Execute actual endpoint with provider/DB mocked; no customer data or real API keys.
let handler,providerCalls=0,updates=[],entitled=true,exists=true,signedIn=true
let file={id:'file',project_id:'project',storage_path:'owner/project/walk.mov',mime_type:'video/quicktime',file_name:'walk.mov',file_size_bytes:100,media_provider_file:'files/test'}
const client={auth:{getUser:async()=>({data:{user:signedIn?{id:'owner'}:null}})},from(table){return {select(){return this},eq(){return this},single:async()=>({data:table==='project_files'?(exists?file:null):{jamie_enabled:entitled}})}}}
const privileged={from(){return {update(v){updates.push(v);return this},eq(){return this},or(){return this},select:async()=>({data:[{id:'file'}]}),then(resolve){resolve({error:null})}}}}
let clients=0
const context=vm.createContext({mediaMime,needsMediaReview,VIDEO_LIMIT,WALKTHROUGH_PROMPT,Request,Response,URL,AbortSignal,Date,setTimeout,createClient:()=>++clients===1?client:privileged,Deno:{env:{get:n=>n==='GEMINI_API_KEY'?'test-key':'test'},serve:fn=>handler=fn},fetch:async(url,init)=>{
 providerCalls++
 if(url.endsWith('/interactions')) {const body=JSON.parse(init.body);assert.equal(body.input[1].type,'video');assert.match(body.input[0].text,/full audio AND/);assert.equal(body.store,false);return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'00:03: Repair joints. Area unknown.'}]}]})}
 if(init?.method==='DELETE')return new Response(null,{status:204})
 return Response.json({state:'ACTIVE',uri:'https://generativelanguage.googleapis.com/v1beta/files/test'})
}})
load('../supabase/functions/jamie-media/index.ts',context)
const call=async()=>{clients=0;return handler(new Request('https://local.test',{method:'POST',body:JSON.stringify({fileId:'file'})}))}
assert.equal((await call()).status,200);assert.ok(updates.some(v=>v.media_status==='ready'&&v.media_notes.includes('Area unknown')))
const before=providerCalls
entitled=false;assert.equal((await call()).status,403)
entitled=true;exists=false;assert.equal((await call()).status,404)
exists=true;signedIn=false;assert.equal((await call()).status,401)
signedIn=true;file.storage_path='other-owner/project/private.mov';assert.equal((await call()).status,403)
assert.equal(providerCalls,before,'Denied requests must never call provider')
console.log('PASS: video narration evidence; reuse/select project photos; pending media blocks pricing; scope bullets preserve numbers; ownership and entitlement gates')
