import assert from 'node:assert/strict'
import {build} from 'vite'
import {chromium} from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
const root=path.resolve(import.meta.dirname,'..')
const entry=path.join(root,'scripts/.crew-ui.tsx')
const proposal={id:'p',project_id:'q',name:'QA landscaping',notes:'No off-site disposal.',status:'draft',work_areas:[{id:'a',enabled:true,resolved_name:'Planting bed',resolved_description:'- Plant 4 grasses.\n- Do not disturb the anchor.',lines:[{id:'l',label:'Landscape labor',category:'labor',quantity:6,unit:'HR',unit_cost:9999,sort_order:0},{id:'m',label:'Mulch',category:'material',quantity:2.5,unit:'CY',unit_cost:8888,sort_order:1}]}]}
const mocks={
  '@/lib/proposals':`export const getProposal=async()=>(${JSON.stringify(proposal)});export const updateProposal=async()=>{throw Error('Unexpected proposal mutation')}`,
  '@/lib/companySettings':`export const loadCompanySettings=async()=>({company_legal_name:'QA Company',pdf_primary_color:'#123456',pdf_show_terms_and_conditions:false})`,
  '@/lib/entitlements':`export const loadEntitlements=async()=>({watermarked:false})`,
  '@/lib/proposalShares':`export const getLatestSignature=async()=>null`,
  '@/lib/supabase':`export const supabase={rpc:async()=>({data:false}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'q',name:'QA job',customer:null}})}),functions:{invoke:async(name,{body})=>{window.translationCalls=(window.translationCalls||0)+1;if(window.failTranslation)return {error:new Error('Offline')};return {data:{texts:Object.fromEntries(Object.entries(body.texts).map(([k,v])=>[k,v.replace('Planting bed','Cantero').replace('Plant 4 grasses.','Plantar 4 pastos.').replace('Do not disturb the anchor.','No alterar el anclaje.').replace('No off-site disposal.','Sin retiro fuera del sitio.').replace('Landscape labor','Trabajo de jardinería').replace('Mulch','Mantillo')]))}}}}}`,
}
fs.writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Page from '../src/pages/ProposalPrintView';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/q/p']}><Routes><Route path='/:projectId/:proposalId' element={<Page/>}/></Routes></MemoryRouter>);`)
let compiled
try{compiled=await build({configFile:false,root,plugins:[{name:'fixture',resolveId(id){if(mocks[id])return '\0'+id},load(id){return mocks[id.slice(1)]}}],resolve:{alias:[{find:/^@\/(?!lib\/(?:proposals|companySettings|entitlements|proposalShares|supabase)$)(.*)$/,replacement:path.join(root,'src')+'/$1'}]},define:{'process.env.NODE_ENV':'"production"'},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry,name:'Fixture',formats:['iife']}}})}finally{fs.unlinkSync(entry)}
const code=(Array.isArray(compiled)?compiled[0]:compiled).output.find(o=>o.type==='chunk').code
const css=fs.readFileSync(path.join(root,'dist-audit/assets',fs.readdirSync(path.join(root,'dist-audit/assets')).find(n=>n.endsWith('.css'))))
const server=http.createServer((req,res)=>{if(req.url==='/b.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(code)}else if(req.url==='/s.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/s.css"><div id="root"></div><script src="/b.js"></script>')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('tab',{name:'Crew',exact:true}).click()
 assert.match(await page.locator('article').innerText(),/Plant 4 grasses/)
 assert.doesNotMatch(await page.locator('article').innerText(),/9999|8888|\$/)
 assert.equal(await page.getByText('Show project total',{exact:true}).count(),0)
 await page.getByLabel('Crew language').selectOption('es')
 assert.equal(await page.getByRole('button',{name:'Print',exact:true}).isDisabled(),true)
 await page.evaluate(()=>window.failTranslation=true)
 await page.getByRole('button',{name:'Prepare Spanish version'}).click()
 await page.getByRole('alert').waitFor()
 assert.equal(await page.getByRole('button',{name:'Print',exact:true}).isDisabled(),true)
 await page.evaluate(()=>window.failTranslation=false)
 await page.getByRole('button',{name:'Prepare Spanish version'}).click()
 await page.locator('article[lang="es"]').waitFor()
 assert.match(await page.locator('article').innerText(),/No alterar el anclaje/)
 assert.match(await page.locator('article').innerText(),/2.5 CY/)
 assert.equal(await page.getByRole('button',{name:'Print',exact:true}).isDisabled(),false)
 await page.getByLabel('Crew language').selectOption('both')
 assert.equal(await page.locator('article').count(),2)
 assert.equal(await page.evaluate(()=>window.translationCalls),2,'Successful translation reused')
 await page.emulateMedia({media:'print'})
 assert.equal(await page.locator('.pv-toolbar').isVisible(),false)
 assert.equal(await page.locator('article[lang="es"]').evaluate(e=>getComputedStyle(e.parentElement).breakBefore),'page')
 fs.mkdirSync(path.join(root,'../../outputs'),{recursive:true})
 await page.pdf({path:path.join(root,'../../outputs/Crew-planner-bilingual-QA.pdf'),format:'Letter',printBackground:true})
 await page.emulateMedia({media:'screen'})
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.locator('article').first().evaluate(e=>e.scrollWidth>e.clientWidth+2),false)
 assert.deepEqual(errors,[])
 console.log('PASS: actual print page English/Spanish/both, failed translation blocks print, retry/cache, numeric quantities, no prices, page break, mobile')
}finally{await browser.close();server.close()}
