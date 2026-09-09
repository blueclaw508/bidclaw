import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LABOR_BASIS_RULES } from '../supabase/functions/_shared/estimatePolicy.ts';

// Exercise the actual prompt builder across workflow stages, without an AI call.
const source = fs.readFileSync(new URL('../supabase/functions/jamie-chat/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('function buildSystemPrompt(');
const end = source.indexOf('\nconst cors =', start);
const compiled = ts.transpileModule(source.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const context = vm.createContext({NEWLINE:'\n', LABOR_BASIS_RULES, WEB_SEARCH_MAX_USES:3});
vm.runInContext(compiled + '\nglobalThis.build = buildSystemPrompt;', context);
const base = {companyName:'Test',projectName:'Synthetic',projectAddress:'',customerName:'',materialsMarkup:50,subsMarkup:20,laborTypes:[],equipmentRates:[],catalog:[],kits:[],priceBook:[],existingWorkAreas:[],stagedWorkAreas:[],reviewingWorkAreas:[],approvedRunWorkAreas:[],reviewingLines:[]};
let prompt = context.build('chat', base);
assert.match(prompt,/TASK — SCOPE CONVERSATION/);
assert.doesNotMatch(prompt,/TASK — CONTINUE THE APPROVED ESTIMATE/);
prompt = context.build('chat', {...base,reviewingWorkAreas:['Patio']});
assert.match(prompt,/THE CONTRACTOR IS REVIEWING YOUR PROPOSAL RIGHT NOW/);
prompt = context.build('chat', {...base,existingWorkAreas:[{id:'saved',name:'Patio',description:'Prepared bed'}],approvedRunWorkAreas:[{name:'Patio',hasTakeoff:false},{name:'Mulch',hasTakeoff:true}]});
assert.match(prompt,/TASK — CONTINUE THE APPROVED ESTIMATE/);
assert.doesNotMatch(prompt,/TASK — SCOPE CONVERSATION/);
assert.match(prompt,/Patio: awaiting pricing/);
assert.match(prompt,/Mulch: takeoff already generated/);
assert.match(prompt,/not a duplicate or a reason to repeat Pass 1/);
prompt = context.build('chat', {...base,approvedRunWorkAreas:[{name:'Patio',hasTakeoff:true}],reviewingLines:[{id:'line',workArea:'Patio',workOrderScope:'Six hours',reasoning:'Contractor instruction',label:'Mason',category:'labor',unit:'HR',quantity:6,unitCost:95,needsPricing:false}]});
assert.match(prompt,/THE CONTRACTOR IS REVIEWING YOUR TAKEOFF RIGHT NOW/);
assert.match(prompt,/set_line_prices/);
assert.match(prompt,/Six hours/);
for (const action of ['chat','propose_work_areas','propose_lines']) {
  prompt = context.build(action, base);
  assert.ok(prompt.includes(LABOR_BASIS_RULES));
  assert.doesNotMatch(prompt,/full crew day (?:is|=) 27/i);
}
console.log('PASS: initial scope, scope review, approved-area continuation, mixed batches, pending revision and shared labor policy');

// Exercise the real server review guard and batch-completion state updates.
const guardStart = source.indexOf('    const { data: pendingReview, error: reviewError }');
const guardEnd = source.indexOf('    let stagedQuery', guardStart);
const finishStart = source.indexOf('          const { error: lineErr } = await service.from');
const finishEnd = source.indexOf('          const unpriced =', finishStart);
assert.ok(guardStart > 0 && finishStart > guardStart);
async function runBlock(block, {pending=false, failRead=false, failState=false}={}) {
  const states=[];
  const service={from(table){
    let mode='read',payload;
    const q={select(){return q},eq(){return q},not(){return q},in(){return q},limit(){return q},insert(){mode='insert';return q},update(p){mode='update';payload=p;return q},then(resolve,reject){
      if(mode==='update') states.push(payload.status);
      const data=table==='jamie_proposed_work_areas' ? [{id:'wa1'},{id:'wa2'}] : block==='guard' ? (pending?[{id:'line'}]:[]) : [{jamie_proposed_work_area_id:'wa1'}];
      return Promise.resolve({data,error:(failRead || (failState && mode==='update'))?{message:'simulated failure'}:null}).then(resolve,reject);
    }}; return q;
  }};
  const code = block==='guard' ? source.slice(guardStart,guardEnd) : source.slice(finishStart,finishEnd);
  const sandbox=vm.createContext({service,run:{id:'run'},rows:[{id:'line'}],json:(body,status)=>({body,status})});
  const js=ts.transpileModule('async function exercise(){'+code+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInContext(js+'\nglobalThis.exercise=exercise;',sandbox);
  return {result:await sandbox.exercise(),states};
}
assert.equal((await runBlock('guard',{pending:true})).result.status,409);
assert.equal((await runBlock('guard',{failRead:true})).result.status,500);
assert.equal((await runBlock('guard')).result,undefined);
assert.deepEqual((await runBlock('finish')).states,['awaiting_line_approval'],'First batch opens review even with another area unpriced');
await assert.rejects(()=>runBlock('finish',{failState:true}),/review could not open/);
console.log('PASS: pending-review blocks next batch, failed checks stop generation, partial batch opens review, failed state update is reported');
