import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root,'scripts/.kyn-ui-fixture.tsx')
fs.writeFileSync(entry, `
import React from 'react';import {createRoot} from 'react-dom/client';
import {KynImportCard} from '../src/components/settings/KynImportCard';
createRoot(document.getElementById('root')).render(<KynImportCard onImported={()=>{}}/>);
`)
const mock = `
export class KynSyncError extends Error {}
const model={year:2026,company_name:'Fixture',updated_at:'2026-09-09T00:00:00Z',divisions:[{index:0,name:'Construction',crews:1,equipment:0}]};
export async function loadKynCatalogue(){return {catalogue:[model]}}
export async function previewKynImport(){return {catalogue:[model],previewToken:'test-token',source:{year:2026,company:'Fixture',updated_at:model.updated_at},markupPlan:{fromDivision:'preserved',materials:null,subs:null},plans:[{kynIndex:0,division:'Construction',isNewDivision:false,labor:{incoming:[{name:'Mason',rate:110,action:'keep',currentRate:95}],overwrites:0,appends:0,untouched:1},equipment:{incoming:[],overwrites:0,appends:0,untouched:0},markups:{materials:50,subs:35},incomingMarkups:{materials:60,subs:40},unmappedMarkups:{}}]}}
export async function applyKynImport(year,divisions,token){document.querySelector('output').textContent=JSON.stringify({year,divisions,token});throw new KynSyncError('Stale preview')}
`
let compiled
try { compiled = await build({configFile:false,root,plugins:[{name:'mock-kyn',enforce:'pre',resolveId(id){if(id==='@/lib/kynSync' || id.replaceAll('\\','/').endsWith('/src/lib/kynSync'))return '\0mock-kyn'},load(id){if(id==='\0mock-kyn')return mock}}],resolve:{alias:{'@':path.join(root,'src')}},define:{'process.env.NODE_ENV':JSON.stringify('production')},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry,name:'Fixture',formats:['iife']}}}) } finally {fs.unlinkSync(entry)}
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
  await page.getByRole('button',{name:'Find my KYN numbers'}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Show me what will come across'}).click();
  await page.getByText('Keep saved rate; KYN proposes $110.00/hr').waitFor();
  assert.match(await page.locator('body').innerText(),/per person-hour/);
  assert.match(await page.locator('body').innerText(),/Saved division markups are preserved/);
  await page.getByRole('button',{name:'Import these numbers'}).click();
  const payload=JSON.parse(await page.locator('output').innerText());
  assert.deepEqual(payload,{year:2026,divisions:[0],token:'test-token'});
  await page.getByRole('button',{name:'Show me what will come across'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Import these numbers'}).count(),0);
  assert.deepEqual(errors,[])
  console.log('PASS: KYN import preview, kept vs incoming rate, person-hour units, token submission, and stale-preview reset')
} finally { await browser.close(); server.close() }

