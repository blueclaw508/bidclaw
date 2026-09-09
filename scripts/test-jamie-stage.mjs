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
