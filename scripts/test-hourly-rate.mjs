import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {configuredHourlyRate} from '../supabase/functions/_shared/hourlyRate.ts'
const rates=[{name:'Landscape Mason',rate:95},{name:'Landscape Construction',rate:85}]
assert.equal(configuredHourlyRate('Landscape Mason - relay',null,rates).cost,95)
assert.equal(configuredHourlyRate('Relay stone','Landscape Mason',rates).cost,95)
assert.equal(configuredHourlyRate('Mason',null,rates).cost,0)
assert.equal(configuredHourlyRate('Landscape Mason','Unknown',rates).cost,0)
assert.equal(configuredHourlyRate('Landscape Mason',null,[...rates,{name:'Landscape Mason',rate:125}]).cost,0)
const source=fs.readFileSync(new URL('../supabase/functions/jamie-estimate/index.ts',import.meta.url),'utf8')
const loop=source.slice(source.indexOf('    for (const line of parsed.line_items)'),source.indexOf('    // 7. Log the run'))
const parsed={line_items:[{name:'Relay',category:'Labor',rate_name:'Landscape Mason',unit_cost:900,unit:'HR'},{name:'Blower',category:'Equipment',rate_name:null,unit_cost:15,unit:'HR'},{name:'Stone',category:'Materials',unit_cost:25,unit:'SF'}]}
vm.runInNewContext(loop,{parsed,configuredHourlyRate,laborTypes:rates,equipmentRates:[],catalog:[],catalogPriceEvidence:()=>({label:'Catalog',review:false})})
assert.equal(parsed.line_items[0].unit_cost,95)
assert.equal(parsed.line_items[1].unit_cost,0)
assert.equal(parsed.line_items[2].unit_cost,25)
console.log('PASS: exact configured rate overrides model price; unmatched/ambiguous rates require entry; material pricing unchanged')
