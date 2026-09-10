import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
import {protectNumbers,restoreNumbers} from '../supabase/functions/crew-translate/policy.ts'
import {crewTexts,completeCrewTranslation} from '../src/lib/crewPlanner.ts'

const original='- Remove 250 SF, 2 inches deep; no disposal.\n- Plant four #3 grasses; use 1/2 inch joints and 2.5 CY.'
const protectedText=protectNumbers(original)
assert.equal(restoreNumbers(protectedText.masked,protectedText.values),original)
assert.throws(()=>restoreNumbers(protectedText.masked.replace('⟦N0⟧','500'),protectedText.values))
assert.throws(()=>restoreNumbers(protectedText.masked+' ⟦N0⟧',protectedText.values))
assert.throws(()=>restoreNumbers(protectedText.masked.replace('⟦N0⟧',''),protectedText.values))
const texts=crewTexts({name:'QA',notes:'No off-site disposal'},[{id:'a',resolved_name:'Bed',resolved_description:original,lines:[{id:'l',label:'Mulch',quantity:2.5,unit_cost:9999}]}])
assert.equal(JSON.stringify(texts).includes('9999'),false)
assert.equal(completeCrewTranslation(texts,texts),true)
assert.equal(completeCrewTranslation(texts,{title:'QA'}),false)

let handler; let owned=true; let signedIn=true; let calls=0; let corrupt=false
const context=vm.createContext({Response,Request,AbortSignal,console,
  Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn}},
  createClient:()=>({auth:{getUser:async()=>({data:{user:signedIn?{id:'u'}:null}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:owned?{id:'p'}:null})})}),
  fetch:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.store,false);const source=JSON.parse(body.input[0].text.split('SOURCE JSON:\n')[1]);if(corrupt)source.scope=source.scope.replace('⟦N0⟧','500');return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(source)}]}]})}
})
let policy=fs.readFileSync(new URL('../supabase/functions/crew-translate/policy.ts',import.meta.url),'utf8').replaceAll('export ','')
let source=fs.readFileSync(new URL('../supabase/functions/crew-translate/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
vm.runInContext(stripTypeScriptTypes(policy+'\n'+source),context)
const request=()=>new Request('http://fixture',{method:'POST',body:JSON.stringify({proposalId:'p',texts:{scope:original}})})
let result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).texts.scope,original)
corrupt=true;assert.equal((await handler(request())).status,502);corrupt=false
owned=false;assert.equal((await handler(request())).status,404);assert.equal(calls,2)
signedIn=false;assert.equal((await handler(request())).status,401);assert.equal(calls,2)
console.log('PASS: actual translation handler ownership/auth, numeric preservation, no quantities/prices sent, complete response required')
