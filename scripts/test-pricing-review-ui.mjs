import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root,'scripts/.pricing-ui-fixture.tsx')
fs.writeFileSync(entry, `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {LineGate} from '../src/components/jamie/GateReview';
    const lines = [
      {id:'labor', category:'labor', label:'Mason',unit:'HR',quantity:24,unit_cost:95,needs_pricing:false,reasoning:'Measured repair scope'},
      {id:'stone',category:'material',label:'Stone',unit:'SF',quantity:100,unit_cost:10,needs_pricing:true,reasoning:'Unconfirmed supplier cost'}
    ];
    createRoot(document.getElementById('root')).render(<main className="app-readable"><LineGate groups={[{id:'test',proposed_name:'Isolated pricing fixture',proposed_description:'Test',proposed_client_description:'Test',lines}]} markups={{markup_materials_percent:50,markup_subs_percent:35}} busy={false} onCommit={() => {throw new Error('Test must never commit')}} /></main>);
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
  const summary=page.locator('summary').filter({hasText:'Check the pricing'})
  await summary.click()
  await page.getByRole('region',{name:'Labor hours review'}).waitFor()
  await page.getByLabel('Your expected total person-hours for this scope').fill('20')
  await page.getByText('24 estimated vs 20 expected person-hours: 4 hours (20%) above your benchmark.').waitFor()
  await page.getByLabel('Crew members',{exact:true}).fill('3')
  await page.getByLabel('Hours per person per day',{exact:true}).fill('8')
  await page.getByText('24 person-hours ÷ (3 people × 8 hours) = 1 equivalent crew-days.').waitFor()
  await page.getByLabel('Measured scope quantity').fill('100')
  await page.getByLabel('Your comparable selling price').fill('30')
  assert.match(await summary.innerText(), /3,780\.00/)
  await page.getByText('26% above your comparison price.').waitFor()
  await page.getByText('Provisional rate. Confirm before adding.').waitFor()
  await page.getByLabel('Measurement unit').selectOption('LF')
  assert.equal(await page.getByLabel('Your comparable selling price').inputValue(),'','Unit changes clear the incompatible benchmark')
  await page.getByRole('button',{name:'Skip Mason',exact:true}).click()
  assert.match(await summary.innerText(), /1,500\.00 · 0 person-hours/,'Skipped labor disappears from inspection')
  await page.getByRole('button',{name:'Keep Mason',exact:true}).click()
  assert.match(await summary.innerText(), /3,780\.00 · 24 person-hours/)
  for (const width of [1100,390]) {
    await page.setViewportSize({width,height:800})
    const overflow=await page.locator('details').first().evaluate(el => el.scrollWidth > el.clientWidth + 2)
    assert.equal(overflow,false,`Pricing panel fits at ${width}px`)
  }
  assert.deepEqual(errors,[])
  console.log('PASS: actual LineGate review, crew conversion, unit price, source labels, unit reset, skip/keep recalculation, desktop/mobile layout; no commits')
} finally { await browser.close(); server.close() }

