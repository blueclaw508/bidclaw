import test from 'node:test'
import assert from 'node:assert/strict'
import {createJobFeed} from './handler.mjs'
const id=n=>`${n}1111111-1111-4111-8111-111111111111`,user=id(1),company=id(2),workspace=id(3),sourceId=id(5)
test('source feed binds account and excludes every non-operational status and private field',async()=>{
 let grant;const handle=createJobFeed({identity:async t=>t==='session'?{id:user}:null,store:{issue:async g=>grant=g,grant:async()=>grant,jobs:async()=>['approved','in_progress','draft','estimating','proposed','complete','lost','archived'].map((status,i)=>({id:id(i+1),user_id:user,name:status,status,notes:'private',price:999})).concat({id:sourceId,user_id:id(9),status:'approved',name:'Other account'})}})
 assert.equal((await handle(new Request('https://source',{method:'POST',headers:{authorization:'Bearer bad'},body:JSON.stringify({workspaceId:workspace,companyId:company})}))).status,401)
 const issued=await (await handle(new Request('https://source',{method:'POST',headers:{authorization:'Bearer session'},body:JSON.stringify({workspaceId:workspace,companyId:company})}))).json()
 assert.ok(issued.token.startsWith('ccj_'));assert.equal(grant.token_hash.length,64);assert.notEqual(grant.token_hash,issued.token)
 const data=await (await handle(new Request('https://source',{headers:{authorization:`Bearer ${issued.token}`}}))).json();assert.equal(data.jobs.length,2);assert.equal(data.jobs[0].notes,undefined);assert.equal(data.companyId,company)
 grant.expires_at='2000-01-01';assert.equal((await handle(new Request('https://source',{headers:{authorization:`Bearer ${issued.token}`}}))).status,401)
})
