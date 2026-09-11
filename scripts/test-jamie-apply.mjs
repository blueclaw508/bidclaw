import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/components/project/estimate/WorkAreaEstimate.tsx', import.meta.url), 'utf8');
function load(name, end, values) {
  const start = source.indexOf(`  const ${name} =`);
  const text = source.slice(start, source.indexOf(end, start));
  const code = ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const context = vm.createContext({...values});
  vm.runInContext(code + `\nglobalThis.run = ${name}`, context);
  return context.run;
}
const lines = [{sort_order: 3, label: 'Existing line'}];
let calls = [];
const base = {lines, workArea:{id:'new-test-area'}, jamieCategoryToDb:()=> 'labor',
  onLinesChange:fn=>calls.push(['display',fn(lines)]),
  addWorkAreaLinesBulk:async rows=>{calls.push(['insert',rows]);return rows;},
  onScopesChange:async (text,crew)=>{calls.push(['scope',text,crew]);return true;}};
const items = [{name:'Mason',category:'Labor',unit:'HR',qty:5,unit_cost:95}];
let apply = load('handleJamieApply', '  /**',base);
await assert.rejects(()=>apply(items,'  '), /client scope/i);
assert.equal(calls.length,0);
apply = load('handleJamieApply', '  /**',{...base,onScopesChange:async()=>false});
await assert.rejects(()=>apply(items,'Repair 30 SF of patio.','Lift, reset and re-joint.'), /No lines were added/);
assert.equal(calls.length,0);
apply = load('handleJamieApply', '  /**',base);
await apply(items,' Repair 30 SF of patio. ',' Lift, reset and re-joint. ');
assert.deepEqual(calls.map(x=>x[0]), ['scope','insert','display']);
assert.equal(calls[0][1], 'Repair 30 SF of patio.');
assert.equal(calls[0][2], 'Lift, reset and re-joint.');
assert.equal(calls[1][1][0].quantity,5);
assert.equal(lines.length,1);

for (const gcAmount of ['', '0', '-1', 'NaN', '100']) {
  calls=[];
  const gc=load('handleAddGeneralConditions','  const sensors',{
    lines,workArea:{id:'new-test-area'},gcAmount,gcSaving:false,hasGeneralConditions:false,
    setGcSaving:()=>{},setGcAmount:()=>{},toast:{error:message=>{throw new Error(message)}},
    addWorkAreaLine:async row=>{calls.push(row);return row;},onLinesChange:()=>{},
  });
  await gc();
  assert.equal(calls.length,gcAmount==='100'?1:0);
  if(calls.length) assert.equal(calls[0].priceOverride,100,'GC must not receive additional markup');
}
console.log('PASS: reviewed client scope required, failed scope save blocks lines, explicit quantities retained, blank GC writes nothing, manual GC uses exact dollars');
