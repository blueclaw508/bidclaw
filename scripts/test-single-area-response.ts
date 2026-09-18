import assert from 'node:assert/strict'
import {parseSingleAreaResponse,CLARIFICATION_SCHEMA} from '../supabase/functions/_shared/singleAreaResponse.ts'
import {normalizeClarification} from '../supabase/functions/_shared/jamieQuestions.ts'
const answer={summary:'Contractor supplied 283 LF, 24 inch base and 20 inch cap.',measurement_status:'confirmed',gap_questions:[{prompt:'Who supplies the gates?',choices:['Contractor','Others'],kind:'choice'}]}
const parsed=parseSingleAreaResponse({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(answer)}]})
const clarification=normalizeClarification(parsed)
assert.equal(clarification.measurement_status,'confirmed')
assert.equal(clarification.questions.length,1)
assert.equal(clarification.ready,false)
assert.equal(normalizeClarification({...parsed,gap_questions:[]}).ready,true)
assert.equal(normalizeClarification({...parsed,measurement_status:'missing',gap_questions:[]}).ready,false)
assert.throws(()=>parseSingleAreaResponse({stop_reason:'max_tokens',content:[{type:'text',text:'{"summary":"cut'}]}),/cut short/)
assert.throws(()=>parseSingleAreaResponse({stop_reason:'end_turn',content:[{type:'text',text:'{"summary":"cut'}]}),/incomplete answer/)
assert.throws(()=>parseSingleAreaResponse({stop_reason:'refusal',content:[]}),/could not process/)
assert.ok(!('line_items' in CLARIFICATION_SCHEMA.properties))
console.log('Single-area clarification and incomplete-response regression checks passed')
