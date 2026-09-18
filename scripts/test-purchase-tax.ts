import assert from 'node:assert/strict'
import {estimateLineBase,estimateLineTotal,estimateUnitCostWithTax,frozenEstimatePriceOverride,lineTotal} from '../src/lib/money'
const settings={markup_materials_percent:20,markup_subs_percent:10}
const material={category:'material' as const,quantity:10,unit_cost:100,price_override:null,sales_tax_percent:6.25}
assert.equal(estimateLineBase(material),1062.5)
assert.equal(estimateLineTotal(material,settings),1275)
assert.equal(estimateLineTotal({...material,sales_tax_percent:0},settings),1200)
assert.equal(estimateLineTotal({...material,sales_tax_percent:undefined},settings),1200)
assert.equal(estimateLineTotal({...material,price_override:900},settings),900)
for(const quantity of [0.01,0.33,1,3.75,100]) for(const unit_cost of [0.01,0.17,32.99,105.36]) {
 const row={...material,quantity,unit_cost}
 assert.equal(lineTotal({quantity,frozen_unit_cost:estimateUnitCostWithTax(row),frozen_markup_percent:20,price_override:frozenEstimatePriceOverride(row,settings)}),estimateLineTotal(row,settings))
}
assert.equal(estimateLineTotal({category:'labor',quantity:8,unit_cost:26,price_override:null},settings),208)
console.log('Purchase-tax calculations, existing-price preservation, overrides and proposal rounding passed.')
