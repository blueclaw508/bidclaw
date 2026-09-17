import assert from 'node:assert/strict'
import { prepareRebuild, subcontractArea, extractProposalText } from '../src/lib/proposalImport'
import { importedLines, type IngestWorkArea, type IngestReconstruction } from '../src/lib/ingest'
import { estimateLineTotal, sumMoney } from '../src/lib/money'
const area: IngestWorkArea = {name:'Pool',scope_description:'Pool shell and plumbing',stated_total:110000,kind:'base',line_items:[]}
const sub = subcontractArea(area,{name:'BWP',markup:10,basis:'selling'})
assert.equal(sub.line_items[0].unit_cost,100000)
assert.equal(sub.stated_total,110000)
assert.equal(sub.line_items.length,1)
assert.equal(subcontractArea(area,{name:'BWP',markup:10,basis:'cost'}).stated_total,121000)
const zero = subcontractArea(area,{name:'BWP',markup:0,basis:'selling'})
assert.equal(importedLines(zero,'test',()=>35)[0].markup_override,0)
const cents = subcontractArea({...area,stated_total:123.45},{name:'BWP',markup:17,basis:'selling'})
const lines = importedLines(cents,'test',()=>35)
assert.equal(lines.reduce((sum,l)=>sum+(l.price_override ?? l.quantity*l.unit_cost*(1+l.markup_override/100)),0),123.45)
assert.equal(lines.at(-1)?.unit_cost,0)
assert.throws(()=>subcontractArea(area,{name:'BWP',markup:NaN,basis:'selling'}))
const landscape = {...area,name:'Landscape',stated_total:1000,line_items:[{category:'labor' as const,label:'Planting',qty:10,unit:'HR',unit_cost:100}]}
const raw: IngestReconstruction = {customer_name:null,site_address:null,proposal_date:null,base_total:111000,exclusions:null,payment_terms:null,work_areas:[area,landscape,{...area,name:'Cover',kind:'equipment_selection',stated_total:11000}]}
const result = prepareRebuild(raw,{0:{name:'BWP',markup:10,basis:'selling'},2:{name:'BWP',markup:10,basis:'selling'}},[2])
assert.equal(result.base_total,122000)
assert.deepEqual(result.work_areas[1],landscape)
assert.equal(raw.work_areas[2].kind,'equipment_selection')
assert.equal(result.work_areas[2].line_items[0].unit_cost,10000)
await assert.rejects(extractProposalText(new File(['x'],'old.doc')),/Save As/)
await assert.rejects(extractProposalText(new File(['x'],'image.png')),/PDF or Word/)
console.log('PASS: reverse/add markup, zero markup, exact cents, option selection, independent landscape detail, unsupported formats')
const settings = {markup_materials_percent:50,markup_subs_percent:35}
const fractional: IngestWorkArea = {...area,stated_total:0.12,line_items:[1,2].map(i=>({category:'material',label:`Part ${i}`,qty:1,unit:'EA',unit_cost:0.05,markup_pct:10}))}
const fractionLines = importedLines(fractional,'test',()=>50)
assert.equal(fractionLines.at(-1)?.unit_cost,0)
assert.equal(sumMoney(fractionLines.map(l=>estimateLineTotal(l,settings))),0.12)
const unwind: IngestWorkArea = {...area,stated_total:100,line_items:[{category:'material',label:'Billed materials',qty:1,unit:'LS',unit_cost:100}]}
const unwindLines = importedLines(unwind,'test',()=>50)
assert.equal(unwindLines[0].unit_cost,66.67)
assert.equal(unwindLines[0].markup_override,50)
assert.equal(unwindLines[0].price_override,100)
assert.equal(unwindLines.at(-1)?.unit_cost,0)
assert.equal(sumMoney(unwindLines.map(l=>estimateLineTotal(l,settings))),100)
const fractionalBase: IngestWorkArea = {...area,stated_total:0.04,line_items:[1,2].map(i=>({category:'material',label:`Fraction ${i}`,qty:0.05,unit:'EA',unit_cost:0.1,markup_pct:100}))}
assert.equal(sumMoney(importedLines(fractionalBase,'test',()=>0).map(l=>estimateLineTotal(l,settings))),0.04)
const labor: IngestWorkArea = {...area,stated_total:100,line_items:[{category:'labor',label:'Crew',qty:1,unit:'HR',unit_cost:100,markup_pct:10}]}
assert.equal(importedLines(labor,'test',()=>50)[0].markup_override,0)
console.log('PASS: rounded lines, fractional base, recovered cost rounding, labor markup exclusion')
