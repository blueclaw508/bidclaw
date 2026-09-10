import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
const source=fs.readFileSync(new URL('../src/lib/jamieLoop.ts',import.meta.url),'utf8')
const start=source.indexOf('export async function commitWorkAreaGate(')
const end=source.indexOf('\n/**',start)
const writes=[]
const supabase={from(table){return {select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[{sequence_order:2}]}),
  insert(value){writes.push({table,insert:value});this.inserted=true;return this},
  update(value){writes.push({table,update:value});return this},
  single:async function(){return {data:this.inserted?{id:'new-area'}:{project_id:'qa-project'}}},
  then(resolve){return Promise.resolve({error:null}).then(resolve)}
}}}
const context=vm.createContext({supabase,setRunStatus:async()=>{}})
vm.runInContext(stripTypeScriptTypes(source.slice(start,end).replace('export ',''))+'\nglobalThis.run=commitWorkAreaGate',context)
await context.run('run',[{id:'staged',approved:true,name:'  Bed preparation only  ',description:'  - Hand strip 250 SF.\n- No mulch in this area.  '}])
assert.equal(writes.length,2)
assert.equal(writes[0].insert.name,'Bed preparation only')
assert.equal(writes[1].update.proposed_name,writes[0].insert.name)
assert.equal(writes[1].update.proposed_description,writes[0].insert.description)
assert.equal(writes[1].table,'jamie_proposed_work_areas')
assert.equal(writes[0].insert.sequence_order,3)
console.log('PASS: actual work-area approval passes edited name/scope to pricing and appends without updating existing work areas')
