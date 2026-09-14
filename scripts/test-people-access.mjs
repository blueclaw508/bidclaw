import {build} from '../node_modules/esbuild/lib/main.js'
import {chromium} from '../node_modules/playwright/index.mjs'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..')
const compiled=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/pages/PeopleAccess';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'isolated-api',setup(b){
 b.onResolve({filter:/^@\/contexts\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}))
 b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?`export const useAuth=()=>({user:{email:'owner@example.test'},workspaceOwnerId:'owner',isWorkspaceOwner:!location.search.includes('admin')});`:`window.calls=[];const rows=[];export const supabase={from(){const q={select(){return q},order(){return Promise.resolve({data:[...rows],error:null})}};return q},async rpc(name,args){window.calls.push([name,args]);if(args.p_email==='fail@example.test')return{error:{message:'Access service unavailable'}};let row=rows.find(r=>r.email===args.p_email);if(!row){row={id:args.p_email,email:args.p_email,created_at:'2026-09-14'};rows.push(row)}row.active=args.p_active;return{data:row.id,error:null}}};`}))
}}]})
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const p=await browser.newPage({viewport:{width:390,height:844}})
 await p.route('https://people.test/**',r=>r.fulfill({contentType:r.request().url().endsWith('.js')?'text/javascript':'text/html',body:r.request().url().endsWith('.js')?compiled.outputFiles[0].text:'<div id="root"></div><script type="module" src="/app.js"></script>'}))
 await p.goto('https://people.test')
 await p.getByText('No additional administrators yet.').waitFor()
 await p.getByLabel('Email address').fill('DAVE@example.test')
 await p.getByRole('button',{name:'Add administrator',exact:true}).click()
 await p.getByText('Administrator · Access enabled',{exact:true}).waitFor()
 assert.equal((await p.evaluate(()=>window.calls))[0][1].p_email,'dave@example.test')
 p.on('dialog',d=>d.accept())
 await p.getByRole('button',{name:'Revoke access'}).click()
 await p.getByText('Administrator · Access revoked',{exact:true}).waitFor()
 await p.getByRole('button',{name:'Restore access'}).click()
 await p.getByText('Administrator · Access enabled',{exact:true}).waitFor()
 await p.getByLabel('Email address').fill('fail@example.test')
 await p.getByRole('button',{name:'Add administrator',exact:true}).click()
 await p.getByRole('alert').filter({hasText:'Access service unavailable'}).waitFor()
 await p.goto('https://people.test/?admin')
 await p.getByText('The company owner manages administrator access.').waitFor()
 assert.equal(await p.getByRole('button',{name:'Add administrator',exact:true}).count(),0)
 console.log('People & Access UI passed: normalized email, add/revoke/restore, service error, administrator controls hidden. Database authorization is tested separately.')
} finally{await browser.close()}
