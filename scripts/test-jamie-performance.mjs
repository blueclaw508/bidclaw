import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { orderedConcurrentMap, cachedSystemPrompt } from '../supabase/functions/_shared/jamiePerformance.ts'

const source=fs.readFileSync(new URL('../supabase/functions/jamie-chat/index.ts',import.meta.url),'utf8')
const start=source.indexOf('function fileKind(')
const end=source.indexOf('/** Content blocks',start)
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
async function run(limit) {
  let active=0, peak=0
  const uploaded=[],updates=[]
  const rows=Array.from({length:6},(_,i)=>({id:String(i),file_name:`sheet${i}.pdf`,mime_type:'application/pdf',storage_path:String(i)}))
  rows.splice(2,0,{id:'cached',file_name:'cached.pdf',mime_type:'application/pdf',anthropic_file_id:'existing'})
  rows.push({id:'bad',file_name:'failed.pdf',mime_type:'application/pdf',storage_path:'bad'})
  rows.push({id:'unsupported',file_name:'notes.docx',mime_type:'application/docx'})
  rows.push({id:'previous-failure',file_name:'old.pdf',mime_type:'application/pdf',anthropic_sync_error:'prior failure'})
  const service={from:()=>({select:()=>({eq:()=>({order:async()=>({data:rows})})}),update:patch=>({eq:async(_,id)=>{updates.push({id,patch});return {error:null}}})}),storage:{from:()=>({download:async id=>{
    if(id==='bad') return {data:null,error:{message:'fixture download failure'}}
    active++;peak=Math.max(peak,active)
    await new Promise(r=>setTimeout(r,20))
    return {data:{id}}
  }})}}
  const anthropic={beta:{files:{upload:async({file})=>{
    await new Promise(r=>setTimeout(r,20));uploaded.push(file.name);active--;return {id:`remote-${file.name}`}
  }}}}
  const context=vm.createContext({orderedConcurrentMap:(items,_limit,task)=>orderedConcurrentMap(items,limit,task),FILES_BETA:'fixture',toFile:async(blob,name)=>({blob,name})})
  vm.runInContext(code+'\nglobalThis.sync=syncProjectFiles',context)
  const t=performance.now();const result=await context.sync(service,anthropic,'isolated');const elapsed=performance.now()-t
  assert.deepEqual(Array.from(result,r=>r.id),['0','1','cached','2','3','4','5'],'Completion order must not reorder plan/cache prefix')
  assert.equal(uploaded.length,6,'Cached/unsupported/previously failed files are not uploaded')
  assert.equal(peak,limit)
  assert.ok(updates.some(x=>x.id==='bad' && x.patch.anthropic_sync_error==='fixture download failure'))
  assert.ok(updates.some(x=>x.id==='unsupported' && x.patch.anthropic_sync_error))
  return Math.round(elapsed)
}
const serial=await run(1),concurrent=await run(3)
assert.deepEqual(await orderedConcurrentMap([],3,async x=>x),[])
await assert.rejects(()=>orderedConcurrentMap([1],0,async x=>x))
const prompt='Company-specific rates and all estimating instructions remain intact'
assert.deepEqual(cachedSystemPrompt(prompt),[{type:'text',text:prompt,cache_control:{type:'ephemeral'}}])
assert.match(source,/phase: 'model_leg'/)
assert.match(source,/phase: 'files'/)
assert.match(source,/const checkModel = MODEL_ROUTER.validation/,'Scope reconciliation retained')
assert.match(source,/effort: 'high'/,'Estimating effort retained')
const single=fs.readFileSync(new URL('../supabase/functions/jamie-estimate/index.ts',import.meta.url),'utf8')
assert.match(single,/system: cachedSystemPrompt\(system\)/)
assert.match(single,/effort: 'high'/)
console.log(`PASS: actual file preparation ${serial}ms serial vs ${concurrent}ms with three workers (simulated I/O); order, cached reuse, failure handling, prompt preservation and quality settings passed`)
