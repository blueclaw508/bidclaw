import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {estimateLineTotal,lineTotal,effectiveMarkupPercent,frozenEstimatePriceOverride,resolveMarkups} from '../src/lib/money.ts'
const settings={markup_materials_percent:50,markup_subs_percent:35}
const rows=[{label:'Fractional material',category:'material',quantity:1.5,unit_cost:.99,price_override:null,sort_order:0},{label:'Labor',category:'labor',quantity:3.5,unit_cost:95,price_override:null,sort_order:1},{label:'GC',category:'other',quantity:1,unit_cost:0,price_override:100,sort_order:2}]
assert.equal(estimateLineTotal(rows[0],settings),2.24)
assert.equal(lineTotal({quantity:1.5,frozen_unit_cost:.99,frozen_markup_percent:50}),2.23)
assert.equal(frozenEstimatePriceOverride(rows[0],settings),2.24)
assert.equal(frozenEstimatePriceOverride(rows[1],settings),null)
for(const q of [.01,.15,1,1.5,2.333,26]) for(const cost of [.01,.99,24.45,95]) for(const markup of [0,35,50]) {
 const l={...rows[0],quantity:q,unit_cost:cost,markup_override:markup}
 const frozen={quantity:q,frozen_unit_cost:cost,frozen_markup_percent:effectiveMarkupPercent(l,settings),price_override:frozenEstimatePriceOverride(l,settings)}
 assert.equal(lineTotal(frozen),estimateLineTotal(l,settings))
}
let inserted;const writes=[]
const supabase={from(table){let payload;return {select(){return this},eq(){return this},order(){return this},insert(p){payload=p;writes.push(table);return this},single(){return Promise.resolve({data:table==='company_settings'?settings:{id:'new-proposal'}})},then(resolve){const data=table==='work_areas'?[{id:'qa-area',division_id:null,work_area_lines:rows}]:table==='company_divisions'?[]:table==='proposal_work_areas'?[{id:'pwa',position:0}]:null;if(table==='proposal_lines')inserted=payload;return Promise.resolve({data}).then(resolve)}}}}
const source=fs.readFileSync(new URL('../src/lib/proposals.ts',import.meta.url),'utf8')
const start=source.indexOf('export async function generateProposalFromEstimates(')
const end=source.indexOf('export async function duplicateProposal',start)
const code=ts.transpileModule(source.slice(start,end).replace('export async','async'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const context=vm.createContext({supabase,resolveMarkups,effectiveMarkupPercent,frozenEstimatePriceOverride,syncProposalWorkAreaSubtotals:async()=>{},getProposalTotals:async()=>({grandTotal:434.74}),syncLeadOnProposalGenerated:async()=>{},deleteProposal:async()=>{throw Error('Unexpected cleanup')},console})
vm.runInContext(code+'\nglobalThis.run=generateProposalFromEstimates',context)
await context.run({projectId:'qa',name:'QA only'})
assert.equal(inserted.length,3)
inserted.forEach((line,i)=>assert.equal(lineTotal(line),estimateLineTotal(rows[i],settings)))
assert.equal(rows[0].price_override,null,'Original estimate must stay unchanged')
assert.deepEqual(writes,['proposals','proposal_work_areas','proposal_lines'])
console.log('PASS: actual proposal generation freezes reviewed cents, quantities, labor, GC and overrides; existing estimates unchanged')
