import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { excludeAutomaticAllowances, priceNeedsConfirmation } from '../supabase/functions/_shared/estimatePolicy.ts';

const input = [{label:'Granite slabs'}, {label:'General Conditions & Rounding'}, {label:'Incidentals'}, {label:'Site access protection mats'}];
assert.deepEqual(excludeAutomaticAllowances(input).map(l => l.label), ['Granite slabs','Site access protection mats']);
assert.equal(input.length, 4, 'Filtering must not mutate source evidence');
assert.deepEqual(excludeAutomaticAllowances([{name:'Rounding'}, {name:'Disposal'}]), [{name:'Disposal'}]);

// Exercise the actual commit function with a database double. No paid calls or live writes.
const source = fs.readFileSync(new URL('../src/lib/jamieLoop.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function commitLineGate(');
const end = source.indexOf('// Gate reads', start);
const code = ts.transpileModule(source.slice(start, end).replace('export async', 'async'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

async function exercise(decision, {remaining = [], needsPricing = true} = {}) {
  const writes = []; const statuses = [];
  const staged = [{id:'line1',jamie_proposed_work_area_id:'staged-wa1', label:'Granite slabs',category:'material',unit:'EA',quantity:112,unit_cost:195,needs_pricing:needsPricing,catalog_item_id:null,jamie_proposed_work_areas:{inserted_work_area_id:'wa1'}}];
  const supabase = {
    auth:{getUser:async()=>({data:{user:{id:'owner'}}})},
    from(table) {
      let operation = 'select'; let payload;
      const q = {
        select(){return q},eq(){return q},in(){return q},
        insert(p){operation='insert';payload=p;return q},
        update(p){operation='update';payload=p;return q},
        single(){return q},
        then(resolve,reject) {
          if(operation!=='select') writes.push({table,operation,payload});
          const data = operation==='insert' ? {id:'new-id'} : table==='jamie_proposed_lines' && operation==='select' ? staged : [];
          return Promise.resolve({data,error:null}).then(resolve,reject);
        }
      }; return q;
    }
  };
  const ctx = vm.createContext({supabase,priceNeedsConfirmation,listWorkAreasAwaitingLines:async()=>remaining,setRunStatus:async(_,s)=>statuses.push(s)});
  vm.runInContext(code+'\nglobalThis.commit = commitLineGate;',ctx);
  try { await ctx.commit('run1',[{id:'line1',approved:true,quantity:112,unitCost:195,...decision}]); return {writes,statuses}; }
  catch(error) {return {writes,statuses,error};}
}
let result = await exercise({});
assert.match(result.error.message,/Confirm the price/);
assert.equal(result.writes.length,0,'No partial estimate or catalog writes before price validation');
result = await exercise({priceConfirmed:true});
assert.equal(result.error,undefined);
assert.equal(result.writes.filter(w=>w.table==='catalog_items').length,0,'Takeoff confirmation alone must never populate catalog');
assert.ok(result.writes.some(w=>w.table==='work_area_lines'));
assert.deepEqual(result.statuses,['committed']);
result = await exercise({priceConfirmed:true,saveToCatalog:true});
assert.equal(result.writes.filter(w=>w.table==='catalog_items'&&w.operation==='insert').length,1,'Explicit catalog selection saves one item');
result = await exercise({priceConfirmed:true},{remaining:[{id:'wa2'}]});
assert.deepEqual(result.statuses,[],'Partial takeoff remains open for next batch');
result = await exercise({}, {needsPricing:false});
assert.equal(result.error,undefined,'Existing confirmed prices do not need repeated confirmation');
result = await exercise({priceConfirmed:true,unitCost:NaN});
assert.match(result.error.message,/positive quantity and unit cost/);
assert.equal(result.writes.length,0,'Invalid numbers must fail before any writes');
for (const path of ['../supabase/functions/jamie-chat/index.ts','../supabase/functions/jamie-estimate/index.ts']) {
  const input = fs.readFileSync(new URL(path,import.meta.url),'utf8');
  const parsed = ts.transpileModule(input,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022}});
  assert.equal(parsed.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,path+' must parse');
}
console.log('PASS: allowance filtering, unchanged evidence, confirmation-before-write, catalog opt-in, partial-run continuation, known prices');
