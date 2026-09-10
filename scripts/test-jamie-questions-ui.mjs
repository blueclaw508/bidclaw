import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root,'scripts/.questions-ui-fixture.tsx')
fs.writeFileSync(entry, `
import React from 'react';import {createRoot} from 'react-dom/client';
import {AskJamieModal} from '../src/components/project/estimate/AskJamieModal';
import {ProjectProgress} from '../src/components/ProjectProgress';
createRoot(document.getElementById('root')).render(<><ProjectProgress status="estimating" proposals={[{status:'sent',created_at:'2026-09-09'}]}/><AskJamieModal open onClose={()=>{}} workAreaId="isolated-questions" workAreaName="Bluestone repair" workAreaDescription="Lift and relay bluestone and re-joint" settings={{markup_materials_percent:50,markup_subs_percent:35}} onApply={async()=>{document.querySelector('output').textContent='applied'}}/></>);
`)
const mock = `
export class JamieNotEnabledError extends Error {}
export async function fileToImagePayload(){return null}
export function jamieCategoryToDb(c){return c==='Labor'?'labor':'material'}
let calls=0;
export async function askJamie(input){
 document.querySelector('output').textContent=JSON.stringify(input);
 const question={id:'size',prompt:'How many square feet need lifting and relaying?',kind:'measurement',choices:[]};
 const method={id:'method',prompt:'How should the stone be bedded?',kind:'choice',choices:['Dry-laid','Mortar bed']};
 const base={scope_description:'Crew scope',client_scope_description:'Relay 120 SF of existing bluestone, dry laid.',new_catalog_items:[]};
 if(input.mode==='price')return {...base,gap_questions:[],clarification:{questions:[],summary:'120 SF dry laid',measurement_status:'confirmed',ready:true},line_items:[{name:'Mason',qty:8,unit:'HR',unit_cost:95,category:'Labor'}]};
 if(++calls===1)return {...base,gap_questions:[question.prompt,method.prompt],clarification:{questions:[question,method],summary:'Need measured size and method.',measurement_status:'missing',ready:false},line_items:[]};
 return {...base,gap_questions:[],clarification:{questions:[],summary:'120 SF, dry-laid; reuse existing stone.',measurement_status:'confirmed',ready:true},line_items:[]};
}
`
let compiled
try { compiled = await build({configFile:false,root,plugins:[{name:'mock-kyn',enforce:'pre',resolveId(id){if(id==='@/lib/supabase' || id.replaceAll('\\','/').endsWith('/src/lib/supabase'))return '\0mock-files';if(id==='@/lib/jamie' || id.replaceAll('\\','/').endsWith('/src/lib/jamie'))return '\0mock-kyn'},load(id){if(id==='\0mock-files')return `export const supabase={from(table){return {select(){return this},eq(){return this},single:async()=>({data:{project_id:'project'}}),order:async()=>({data:[{id:'photo1',file_name:'Patio.jpg',mime_type:'image/jpeg'},{id:'photo2',file_name:'Driveway.jpg',mime_type:'image/jpeg'}]})}}}`;if(id==='\0mock-kyn')return mock}}],resolve:{alias:{'@':path.join(root,'src')}},define:{'process.env.NODE_ENV':JSON.stringify('production')},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry,name:'Fixture',formats:['iife']}}}) } finally {fs.unlinkSync(entry)}
const cssFile = fs.readdirSync(path.join(root,'dist-audit/assets')).find(name => name.endsWith('.css'))
const css = fs.readFileSync(path.join(root,'dist-audit/assets',cssFile))
const server = http.createServer((req,res) => {
  if (req.url === '/bundle.js') {res.setHeader('Content-Type','text/javascript; charset=utf-8'); res.end((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code)}
  else if (req.url === '/style.css') {res.setHeader('Content-Type','text/css'); res.end(css)}
  else {res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><output></output><script src="/bundle.js"></script>')}
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const browser = await chromium.launch({channel:'msedge',headless:true})
try {
  const page = await browser.newPage({viewport:{width:1100,height:800}})
  const errors=[]
  page.on('pageerror',error => {errors.push(error.message);console.error(error.message)})
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('checkbox',{name:'Driveway.jpg'}).uncheck();
  await page.getByRole('button',{name:'Ask Jamie',exact:true}).click();
  const review=page.getByRole('button',{name:'Review answers',exact:true});
  await review.waitFor();
  for(const width of [1100,390]){await page.setViewportSize({width,height:800});for(const f of await page.locator('fieldset').all())assert.equal(await f.evaluate(e=>e.scrollWidth>e.clientWidth+2),false);}
  assert.equal(await review.isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:/Add .*lines to estimate/}).count(),0);
  await page.getByRole('textbox',{name:'How many square feet need lifting and relaying?',exact:true}).fill('120 SF');
  assert.equal(await review.isDisabled(),true);
  await page.getByRole('radio',{name:'Dry-laid',exact:true}).check();
  await review.click();
  await page.getByRole('heading',{name:'Review your answers'}).waitFor();
  assert.equal(JSON.parse(await page.locator('output').innerText()).mode,'clarify','Review does not call pricing');
  await page.getByRole('button',{name:'Send confirmed answers'}).click();
  const confirm=page.getByRole('button',{name:'Confirm scope and price'});
  await confirm.waitFor();
  const clarification=JSON.parse(await page.locator('output').innerText());
  assert.equal(clarification.mode,'clarify');assert.match(clarification.scope,/Answer: 120 SF/);assert.match(clarification.scope,/Answer: Dry-laid/);
  assert.equal(await page.getByRole('button',{name:/Add .*lines to estimate/}).count(),0);
  await confirm.click();
  const add=page.getByRole('button',{name:'Add 1 lines to estimate'});await add.waitFor();
  const priced=JSON.parse(await page.locator('output').innerText());assert.deepEqual(priced.projectFileIds,['photo1']);assert.equal(priced.mode,'price');assert.equal(priced.reviewed,true);
  assert.equal(await add.isEnabled(),true);
  assert.match(await page.locator('body').innerText(),/Proposed/);
  assert.doesNotMatch(await page.locator('body').innerText(),/Estimating/);
  // No apply: this fixture proves the flow without writing an estimate.
  await page.reload();await page.getByRole('checkbox',{name:'Driveway.jpg'}).uncheck();
  await page.getByRole('button',{name:'Ask Jamie',exact:true}).click();
  await page.getByRole('button',{name:'Review answers',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'How many square feet need lifting and relaying?',exact:true}).inputValue(),'120 SF','Draft answers survive a reload for the same work area and scope');
  assert.deepEqual(errors,[])
  console.log('PASS: individual answers, choice input, answer review, separate scope confirmation, pricing mode, and single project milestone')
} finally { await browser.close(); server.close() }

