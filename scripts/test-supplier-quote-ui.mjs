import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root,'scripts/.supplier-ui-fixture.tsx')
fs.writeFileSync(entry, `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {SupplierQuoteEditor} from '../src/components/SupplierQuoteEditor';
    function Fixture(){
      const [result,setResult]=useState('');
      return <><SupplierQuoteEditor item={{id:'fixture',unit_cost:195,unit:'each'}} onSave={async changes=>{setResult(JSON.stringify(changes));return true}}/><output>{result}</output></>
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);

  `)
let compiled
try { compiled = await build({configFile:false,root,resolve:{alias:{'@':path.join(root,'src')}},define:{'process.env.NODE_ENV':JSON.stringify('production')},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry,name:'Fixture',formats:['iife']}}}) } finally {fs.unlinkSync(entry)}
const cssFile = fs.readdirSync(path.join(root,'dist-audit/assets')).find(name => name.endsWith('.css'))
const css = fs.readFileSync(path.join(root,'dist-audit/assets',cssFile))
const server = http.createServer((req,res) => {
  if (req.url === '/bundle.js') {res.setHeader('Content-Type','text/javascript; charset=utf-8'); res.end((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code)}
  else if (req.url === '/style.css') {res.setHeader('Content-Type','text/css'); res.end(css)}
  else {res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>')}
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const browser = await chromium.launch({channel:'msedge',headless:true})
try {
  const page = await browser.newPage({viewport:{width:1100,height:800}})
  const errors=[]
  page.on('pageerror',error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const save=page.getByRole('button',{name:'Save quote confirmation'});
  assert.equal(await save.isDisabled(),true);
  await page.getByLabel('Supplier',{exact:true}).fill('Fixture supplier');
  await page.getByLabel('Quote reference or document link').fill('Q-42; delivered');
  await page.getByLabel('Quote date',{exact:true}).fill(new Date().toISOString().slice(0,10));
  await page.getByLabel('Valid through (optional)').fill('2099-01-01');
  assert.equal(await save.isDisabled(),true,'Explicit confirmation required');
  await page.getByRole('checkbox').check();
  await save.click();
  const payload=JSON.parse(await page.locator('output').innerText());
  assert.equal(payload.supplier_quote.unit_cost,195);
  assert.equal(payload.supplier_quote.unit,'each');
  assert.equal(payload.supplier_quote.supplier,'Fixture supplier');
  assert.equal(payload.supplier_quote.confirmed_at,undefined,'Only the server stamps confirmation');
  assert.equal(payload.unit_cost,undefined,'Recording evidence does not change the catalog price');
  assert.equal(await save.isDisabled(),true,'Reconfirmation required for another save');
  for(const width of [1100,390]) {
    await page.setViewportSize({width,height:800});
    assert.equal(await page.locator('section').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
  }
  assert.deepEqual(errors,[])
  console.log('PASS: supplier quote form, explicit confirmation, matching cost/unit payload, no price mutation, mobile layout')
} finally { await browser.close(); server.close() }

