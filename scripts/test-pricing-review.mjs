import assert from 'node:assert/strict'
import { reviewPricing, pricingComparison, positiveNumber } from '../src/lib/pricingReview.ts'

const rows = Object.freeze([
  Object.freeze({ id:'stone', label:'Granite', category:'material', unit:'EA', quantity:112, unitCost:195, price:32760, source:'Provisional' }),
  Object.freeze({ id:'labor', label:'Mason', category:'labor', unit:'HR', quantity:108, unitCost:95, price:10260, source:'Saved' }),
  Object.freeze({ id:'helper', label:'Helper', category:'labor', unit:'hours', quantity:81, unitCost:85, price:6885, source:'Saved' }),
  Object.freeze({ id:'operator', label:'Operator', category:'labor', unit:'hr', quantity:27, unitCost:100, price:2700, source:'Saved' }),
  Object.freeze({ id:'other', label:'Other work', category:'other', unit:'LS', quantity:1, unitCost:999, price:7045.34, source:'Total override' }),
])
const snapshot = JSON.stringify(rows)
const result = reviewPricing(rows)
assert.equal(result.total, 59650.34)
assert.equal(result.personHours, 216)
assert.equal(result.categories.labor, 19845)
assert.equal(result.largest[0].id, 'stone')
const comparison = pricingComparison(result.total, result.personHours, '640', '3', '9', '80')
assert.equal(comparison.crewDays, 8)
assert.equal(comparison.unitPrice, 59650.34 / 640)
assert.equal(comparison.hoursPerUnit, 216 / 640)
assert.ok(comparison.differencePercent > 16 && comparison.differencePercent < 17)
assert.equal(JSON.stringify(rows), snapshot, 'Inspection cannot mutate quantities, prices or order')
for (const text of ['', '0', '-1', 'Infinity', '12oops']) assert.equal(positiveNumber(text), null)
assert.equal(pricingComparison(10, 10, '', '', '', '').unitPrice, null, 'No inferred finished size')
assert.equal(pricingComparison(10, 10, '10', '2.5', '8', '').crewDays, null)
assert.equal(pricingComparison(10, 10, '10', '3', '25', '').crewDays, null)
const mixed = reviewPricing([...rows,
  { ...rows[1], id:'day', unit:'DAY', quantity:2, price:1000 },
  { ...rows[1], id:'crew', unit:'crew-hours', quantity:5, price:500 },
  { ...rows[1], id:'bad', unit:null, quantity:null, price:NaN },
])
assert.equal(mixed.personHours, 216, 'Never count crew-hours or days as person-hours')
assert.equal(mixed.unconvertedLabor, 3)
assert.equal(mixed.invalidPrices, 1)
assert.equal(mixed.total, 61150.34)
assert.equal(reviewPricing([{...rows[0], price:10}]).total, 10, 'Uses displayed override, never recomputes from cost')
console.log('PASS: Black pricing fixture, units, overrides, comparisons, invalid inputs and immutable source rows')
