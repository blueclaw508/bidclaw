import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
import {normalizeClarification,clarificationMatches,serializeAnswers} from '../supabase/functions/_shared/jamieQuestions.ts'
import {prepareSingleAreaResult} from '../supabase/functions/_shared/estimatePolicy.ts'
import {projectMilestone} from '../src/lib/projectProgress.ts'

const missing=normalizeClarification({gap_questions:[],measurement_status:'missing',summary:'Lift and relay bluestone; size is unknown.'})
assert.equal(missing.ready,false);assert.equal(missing.questions[0].kind,'measurement')
const unknown=normalizeClarification({gap_questions:[{prompt:'What is the measured repair area?',kind:'measurement',choices:[]}],measurement_status:'missing',summary:'The contractor does not know the size.'})
assert.equal(unknown.ready,false)
const ready={...normalizeClarification({gap_questions:[],measurement_status:'confirmed',summary:'120 SF lift and relay, as measured by contractor; dry laid.'}),work_area_ids:['a','b']}
assert.equal(clarificationMatches(ready,['b','a']),true)
assert.equal(clarificationMatches(ready,['c']),false)
assert.equal(clarificationMatches(undefined,['a']),false)
assert.equal(normalizeClarification({gap_questions:[],measurement_status:'confirmed',summary:''}).ready,false)
assert.match(serializeAnswers(unknown.questions,{[unknown.questions[0].id]:'120 SF'}),/Question: What is the measured repair area\?\nAnswer: 120 SF/)

// Execute the actual server staging branch with a priced payload containing
// unresolved questions. No scope update, staged line or other write may occur.
const source=fs.readFileSync(new URL('../supabase/functions/jamie-chat/index.ts',import.meta.url),'utf8')
const staging=source.slice(source.indexOf('        let spokenText = assistantText'),source.indexOf("        const {error:replySaveError}"))
const writes=[]
const context=vm.createContext({normalizeClarification,action:'propose_lines',assistantText:'',passText:JSON.stringify({gap_questions:[{prompt:'Area in SF?',kind:'measurement',choices:[]}],measurement_status:'missing',measurement_summary:'No dimensions supplied',work_areas:[{proposed_work_area_id:'a',line_items:[{qty:100,unit_cost:95}]}]}),stagedWorkAreas:[{id:'a'}],service:{from:table=>{writes.push(table);throw Error('Unexpected staging write')}},send:()=>{}})
vm.runInContext(ts.transpileModule(`async function verify(){${staging}\nreturn clarification;} globalThis.verify=verify`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context)
assert.equal((await context.verify()).ready,false);assert.deepEqual(writes,[])

const single=fs.readFileSync(new URL('../supabase/functions/jamie-estimate/index.ts',import.meta.url),'utf8')
const singleParse=single.slice(single.indexOf('    const raw = JSON.parse(textBlock.text)'),single.indexOf('    for (const line of parsed.line_items)'))
for(const priceMode of [true,false]) {
 const c=vm.createContext({priceMode,normalizeClarification,prepareSingleAreaResult,textBlock:{text:JSON.stringify({gap_questions:[],measurement_status:'missing',measurement_summary:'Unknown size',line_items:[{name:'Invented labor',qty:100,unit_cost:95}],new_catalog_items:[]})}})
 vm.runInContext(singleParse+';globalThis.result=parsed',c)
 assert.equal(c.result.line_items.length,0);assert.equal(c.result.gap_questions.length,1)
}
assert.equal(projectMilestone('estimating',[{status:'sent',created_at:'2026-09-09'}]).label,'Proposal sent')
assert.equal(projectMilestone('complete',[{status:'sent',created_at:'2026-09-09'}]).status,'complete')
assert.equal(projectMilestone('approved',[{status:'draft',created_at:'2026-09-09'}]).status,'approved')
console.log('PASS: missing quantities, unanswered questions, exact batch review, actual server withholding of takeoffs, single-area safety, and milestone precedence')
