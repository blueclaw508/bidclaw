import assert from 'node:assert/strict'
import {planRates,previewDigest} from '../supabase/functions/kyn-sync/importPlan.ts'
const saved=[{id:'m',name:'Mason',rate_per_hour:95,division_id:'d'},{id:'h',name:'Helper',rate_per_hour:70,division_id:'d'}]
const plan=planRates([{name:'Helper',rate:80},{name:'Mason',rate:110},{name:'Operator',rate:100}],saved)
assert.deepEqual(plan.incoming.map(r=>[r.name,r.action,r.currentRate]),[['Helper','keep',70],['Mason','keep',95],['Operator','add',null]])
assert.equal(plan.overwrites,0);assert.equal(plan.appends,1);assert.equal(plan.untouched,2)
assert.throws(()=>planRates([{name:'Mason',rate:10},{name:'Mason',rate:20}],saved),/Duplicate/)
assert.throws(()=>planRates([{name:'Mason',rate:10}],[saved[0],saved[0]]),/Multiple/)
assert.throws(()=>planRates([{name:'Invalid',rate:NaN}],[]),/Invalid/)
assert.equal(planRates([{name:'Renamed Mason',rate:110}],saved).appends,1)
const snapshot={source:{year:2026,revision:'one'},saved,plan}
const token=await previewDigest(snapshot)
assert.equal(token,await previewDigest({plan,saved,source:{revision:'one',year:2026}}))
assert.notEqual(token,await previewDigest({...snapshot,source:{year:2026,revision:'two'}}))
assert.notEqual(token,await previewDigest({...snapshot,saved:[{...saved[0],rate_per_hour:120},saved[1]]}))
console.log('KYN import: reordered names, manual rates, duplicates, invalid rates, renames, and stale preview checks passed.')
