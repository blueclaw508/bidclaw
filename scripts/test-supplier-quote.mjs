import assert from 'node:assert/strict'
import { supplierQuoteStatus, catalogPriceEvidence } from '../supabase/functions/_shared/supplierQuote.ts'
const today = new Date().toISOString().slice(0,10)
const quote = {supplier:'Fixture supplier',reference:'Quote 42',quoted_on:today,expires_on:'2099-01-01',unit_cost:195,unit:'each',confirmed_at:new Date().toISOString()}
assert.equal(supplierQuoteStatus(quote,195,'EA').review,false)
assert.equal(supplierQuoteStatus(quote,200,'EA').review,true,'Cost changes invalidate evidence')
assert.equal(supplierQuoteStatus(quote,195,'SF').review,true,'Different units cannot share evidence')
assert.equal(supplierQuoteStatus({...quote,expires_on:today},195,'each').review,false,'Valid through includes today')
assert.equal(supplierQuoteStatus({...quote,quoted_on:'2020-01-01',expires_on:'2020-01-31'},195,'each').review,true)
assert.equal(supplierQuoteStatus({...quote,expires_on:null},195,'each').review,true)
assert.equal(supplierQuoteStatus({...quote,confirmed_at:undefined},195,'each').review,true)
assert.equal(supplierQuoteStatus({...quote,quoted_on:'2026-02-30'},195,'each').review,true)
assert.equal(supplierQuoteStatus({...quote,supplier:123},195,'each').review,true)
assert.match(supplierQuoteStatus(null,195,'each').label,/no supplier quote/)
const catalog=[{name:'Granite',unit:'each',unit_cost:195,supplier_quote:quote}]
assert.match(catalogPriceEvidence(catalog,'Granite',195,'EA').label,/Contractor-confirmed/)
assert.equal(catalogPriceEvidence(catalog,'Granite',200,'EA').review,true)
assert.doesNotMatch(catalogPriceEvidence([...catalog,...catalog],'Granite',195,'EA').label,/Contractor-confirmed/,'Duplicate names never claim verified source')
assert.doesNotMatch(catalogPriceEvidence(catalog,'Other granite',195,'EA').label,/Contractor-confirmed/,'No fuzzy match to a different product')
console.log('PASS: current, expired, undated, malformed, changed-price/unit and ambiguous quote evidence')
