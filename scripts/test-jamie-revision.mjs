import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/jamie-chat/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function applyLinePrices(');
const end = source.indexOf('// ── Structured output schemas', start);
const code = ts.transpileModule(source.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const context = vm.createContext({});
vm.runInContext(code, context);
const updates = [{line_id:'fixture', unit_cost:95, quantity:8, reasoning:'8 mason-hours requested.', work_order_scope:'One mason and one helper for 8 hours each.'}];
let calls = 0;
const service = {async rpc(name, args) {
  calls++;
  assert.equal(name, 'revise_jamie_takeoff');
  assert.equal(args.p_run_id, 'run');
  assert.equal(args.p_updates, updates);
  return {data:8, error:null};
}};
assert.match(await context.applyLinePrices(service, 'run', updates), /Saved 8 lines/);
assert.equal(calls, 1, 'All numbers and text must use one transactional call');
assert.match(await context.applyLinePrices({rpc:async()=>({error:{message:'Incomplete revision'}})}, 'run', updates), /^No revision saved:/);
const schemaCode = source.slice(source.indexOf('const SET_LINE_PRICES_TOOL ='), source.indexOf('interface PriceUpdate'));
vm.runInContext(ts.transpileModule(schemaCode, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText + '\nglobalThis.schema = SET_LINE_PRICES_TOOL;', context);
assert.ok(context.schema.input_schema.properties.updates.items.required.includes('reasoning'));
assert.ok(context.schema.input_schema.properties.updates.items.required.includes('work_order_scope'));
console.log('PASS: complete revision payload, single transactional write, failure reporting, required revised text');
