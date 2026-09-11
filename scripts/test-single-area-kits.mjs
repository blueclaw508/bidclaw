import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
import {companyKitContext} from '../supabase/functions/_shared/companyKitContext.ts'
import {prepareSingleAreaResult,LABOR_BASIS_RULES} from '../supabase/functions/_shared/estimatePolicy.ts'
import {normalizeClarification,QUESTION_SCHEMA,QUESTION_RULES} from '../supabase/functions/_shared/jamieQuestions.ts'
import {configuredHourlyRate} from '../supabase/functions/_shared/hourlyRate.ts'
import {bulletScope,SCOPE_FORMAT_RULES} from '../supabase/functions/_shared/scopeFormat.ts'
const kit={name:'QA planting',status:'active',input_unit:'EA',kit_lines:[{type:'labor',display_name:'Landscape Construction',factor:0.2,factor_unit:'HR/EA',position:0},{type:'labor',display_name:'Missing',factor:0,factor_unit:'HR/EA'}]}
const kits=[kit,{...kit,status:'archived',name:'ARCHIVED FACTOR'}]
const block=companyKitContext(kits)
assert.match(block,/0.2/);assert.doesNotMatch(block,/ARCHIVED FACTOR|"factor":0[,}]/)
let handler, params, calls=0, failKits=false;const filters=[]
const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){return {select(){return this},order(){return this},eq(key,value){filters.push([table,key,value]);return this},insert:async()=>({}),single:async()=>({data:{jamie_enabled:true,company_legal_name:'QA'}}),then(resolve){return Promise.resolve({data:table==='kits'?kits:table==='company_labor_types'?[{name:'Landscape Construction',rate_per_hour:85}]:[],error:table==='kits'&&failKits?{message:'offline'}:null}).then(resolve)}}}}
class Anthropic{beta={messages:{create:async input=>{calls++;params=input;return {content:[{type:'text',text:JSON.stringify({scope_description:'Plant 10 shrubs.',client_scope_description:'Plant 10 shrubs.',line_items:[{name:'Landscape Construction',qty:2,unit:'HR',category:'Labor',unit_cost:999,rate_name:'Landscape Construction',reasoning:'10 EA x 0.2 person-hours/EA = 2 person-hours; QA planting kit.'}],gap_questions:[],measurement_status:'confirmed',measurement_summary:'10 shrubs confirmed',new_catalog_items:[]})}],usage:{}}}}}}
const context=vm.createContext({Response,Request,console,performance,Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn}},createClient:()=>client,Anthropic,companyKitContext,prepareSingleAreaResult,LABOR_BASIS_RULES,normalizeClarification,QUESTION_SCHEMA,QUESTION_RULES,configuredHourlyRate,bulletScope,SCOPE_FORMAT_RULES,MEDIA_EVIDENCE_RULES:'',cachedSystemPrompt:s=>s,FILES_BETA:'fixture',supplierQuoteStatus:()=>({review:false}),catalogPriceEvidence:()=>({label:'fixture',review:false})})
const source=fs.readFileSync(new URL('../supabase/functions/jamie-estimate/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'')
vm.runInContext(stripTypeScriptTypes(source),context)
const req=()=>new Request('http://fixture',{method:'POST',body:JSON.stringify({scope:'Plant 10 shrubs, follow my planting kit.',mode:'price',reviewed:true})})
let result=await handler(req());assert.equal(result.status,200);const output=await result.json()
assert.equal(output.line_items[0].qty,2);assert.equal(output.line_items[0].unit_cost,85);assert.match(output.line_items[0].reasoning,/0.2/)
assert.match(params.system,/QA planting/);assert.doesNotMatch(params.system,/ARCHIVED FACTOR/);assert.ok(filters.some(([t,k,v])=>t==='kits'&&k==='user_id'&&v==='owner'))
failKits=true;result=await handler(req());assert.equal(result.status,500);assert.equal(calls,1,'A failed kit load must not silently fall back to assumptions')
console.log('PASS: actual single-area handler loads owner kits, excludes archived factors, returns labor reasoning, preserves configured rate, blocks failed kit reads')
