// ============================================================
// V2 Pass 2 — Per-Work-Area Estimation (Three-Layer Brain)
// Layer 1: Web search for assembly knowledge
// Layer 2: Catalog-first matching against user's QC items
// Layer 3: Gap filling when info is missing
//
// Scope + line items generated in a SINGLE API call per work area.
// Uses Opus. Temperature 0. Catalog names injected into prompt.
// NO cost/price data generated — quantities and units only.
// ============================================================

import { callAI } from '@/lib/supabase'
import { buildUnifiedEstimatePrompt } from '@/lib/jamiePrompt'
import { processPlanFile } from '@/lib/planProcessor'
import type {
  CatalogItem,
  ProductionRate,
  V2Pass2Response,
  V2Pass1Extraction,
} from '@/lib/types'

// ── Types ──

export interface Pass2V2WorkAreaInput {
  id: string
  name: string
  estimateDescription: string | null
  pass1Extraction: V2Pass1Extraction | null
  planFileUrls: string[]
  userMeasurements?: { name: string; area_sf?: number; linear_ft?: number }[]
  gapAnswers?: { question: string; answer: string }[]
}

export interface Pass2V2Result {
  workAreaId: string
  workAreaName: string
  scopeDescription: string
  lineItems: V2Pass2Response['line_items']
  reasoning: string
  gapQuestions: string[]
  newCatalogItems: string[]
  mode: 'mode1' | 'mode2'
  rawResponse: Record<string, unknown>
}

export interface Pass2V2Progress {
  completedCount: number
  totalCount: number
  currentWorkAreaName: string
  completedResult?: Pass2V2Result
}

// ── Pass 2 System Prompt Builder ──

function buildPass2V2SystemPrompt(
  workArea: Pass2V2WorkAreaInput,
  catalog: CatalogItem[],
  productionRates: ProductionRate[],
  webSearchResults?: string
): string {
  // Get the unified prompt (includes Prime Directive, kit library, catalog block)
  const basePrompt = buildUnifiedEstimatePrompt({
    catalog,
    productionRates,
  })

  // Build work-area-specific context from Pass 1 extraction
  let planContext = ''
  if (workArea.pass1Extraction) {
    const ext = workArea.pass1Extraction
    const relevantDims = ext.dimensions?.filter(d =>
      d.item.toLowerCase().includes(workArea.name.toLowerCase()) ||
      workArea.name.toLowerCase().includes(d.item.toLowerCase())
    ) ?? []
    const relevantMats = ext.materials?.filter(m =>
      m.location?.toLowerCase().includes(workArea.name.toLowerCase()) ||
      workArea.name.toLowerCase().includes(m.item.toLowerCase())
    ) ?? []
    const relevantQtys = ext.quantities ?? []
    const relevantZones = ext.areas_zones?.filter(z =>
      z.name.toLowerCase().includes(workArea.name.toLowerCase()) ||
      workArea.name.toLowerCase().includes(z.name.toLowerCase())
    ) ?? []

    planContext = `
PLAN DATA EXTRACTED BY JAMIE (Pass 1 — already verified):
${relevantDims.length > 0 ? `Dimensions: ${JSON.stringify(relevantDims)}` : ''}
${relevantMats.length > 0 ? `Materials specified: ${JSON.stringify(relevantMats)}` : ''}
${relevantQtys.length > 0 ? `Quantities found: ${JSON.stringify(relevantQtys)}` : ''}
${relevantZones.length > 0 ? `Area zones: ${JSON.stringify(relevantZones)}` : ''}
${ext.scale ? `Plan scale: ${ext.scale}` : ''}
${ext.unknowns?.length ? `Unknowns flagged: ${JSON.stringify(ext.unknowns)}` : ''}
${ext.existing_conditions?.length ? `Existing conditions: ${JSON.stringify(ext.existing_conditions)}` : ''}

FULL EXTRACTION (all plan data — reference for cross-area context):
${JSON.stringify(ext)}
`
  }

  // User measurements override vision estimates
  let measurementContext = ''
  if (workArea.userMeasurements?.length) {
    measurementContext = `
USER MEASUREMENTS (confirmed — override your estimates):
${workArea.userMeasurements.map(m =>
  `${m.name}: ${m.area_sf ? `${m.area_sf} SF` : ''}${m.linear_ft ? `${m.linear_ft} LF` : ''}`
).join('\n')}
`
  }

  // Gap question answers from previous Mode 2 run
  let gapContext = ''
  if (workArea.gapAnswers?.length) {
    gapContext = `
CONTRACTOR ANSWERED THESE QUESTIONS:
${workArea.gapAnswers.map(ga => `Q: ${ga.question}\nA: ${ga.answer}`).join('\n\n')}

Use these answers as confirmed specs. Do NOT ask these questions again.
`
  }

  // Web search results (Layer 1)
  let searchContext = ''
  if (webSearchResults) {
    searchContext = `
WEB SEARCH — ASSEMBLY REFERENCE:
${webSearchResults}

Cross-check search results against the kit library above. Use search
to catch commonly-missed items: weep screed, filter fabric, geogrid,
muriatic acid, wire mesh, rebar, edge restraints.
`
  }

  return `${basePrompt}

═══ WORK AREA YOU ARE ESTIMATING ═══
Name: "${workArea.name}"
${planContext}
${measurementContext}
${gapContext}
${searchContext}

YOUR APPROACH FOR "${workArea.name}":

1. RESEARCH — Use any web search results above to understand the
   complete assembly. What materials go into it? What equipment is
   needed? What are current best practices? Don't rely only on
   reference rates — they tell you how long, but research tells you
   what goes into it.

2. CALIBRATE — Cross-reference against your production rate reference
   data. Field-proven rates from real jobs are more reliable than
   generic internet estimates. But they are baselines — adjust up for
   complexity (tight access, intricate patterns, steep slopes) or
   down for simple/repetitive work.

3. CATALOG MATCH — For every line item, match to the contractor's
   existing catalog first:
   - Exact name match (case-insensitive) → match_status "exact"
   - Close match ("Screened Loam" ≈ "Loam") → match_status "fuzzy"
   - No match → match_status "new", add to new_catalog_items

4. THINK — What about THIS specific project makes it different?
   Site access? Slope? Existing conditions to protect? Scale of work?
   Factor these into your quantities and hours.

ISOLATION RULES (CRITICAL):
- Generate line items ONLY for "${workArea.name}". Nothing else.
- Every line item must directly belong to this work area's scope.
- Labor, equipment, and general conditions are for THIS work area only.

MODE DETECTION:
"Do I have enough specific information to CALCULATE quantities — not
guess, not assume, CALCULATE?"
If YES → Full takeoff. Show the math. Generate complete assembly.
If NO → Generate gap_questions for what's missing. Include placeholder
   line items with qty 0 where you cannot calculate.

Return ONLY valid JSON:
{
  "work_area": "${workArea.name}",
  "scope_description": "• Bullet 1\\n• Bullet 2\\n...",
  "line_items": [
    {
      "name": "Item Name",
      "qty": 100,
      "unit": "SF",
      "category": "Materials",
      "catalog_item_id": "uuid-or-null",
      "match_status": "exact|fuzzy|new"
    }
  ],
  "reasoning": "Brief note on how you approached this estimate — what drove your quantities and hours, which reference rates you used, what you adjusted and why",
  "gap_questions": ["Question if info missing"],
  "new_catalog_items": ["Items not in catalog"]
}

No preamble. No markdown. No explanation. JSON only.`
}

// ── Single Work Area Pass 2 ──

export async function runPass2V2SingleWorkArea(
  workArea: Pass2V2WorkAreaInput,
  catalog: CatalogItem[],
  productionRates: ProductionRate[],
  webSearchResults?: string
): Promise<Pass2V2Result> {
  const system = buildPass2V2SystemPrompt(workArea, catalog, productionRates, webSearchResults)

  // Build content blocks
  const content: Array<Record<string, unknown>> = []

  // Add plan images if available
  if (workArea.planFileUrls.length > 0) {
    for (const url of workArea.planFileUrls) {
      try {
        const plan = await processPlanFile(url)
        if (plan.type === 'image_base64' && plan.data && plan.data.length > 0) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: plan.mediaType ?? 'image/jpeg',
              data: plan.data,
            },
          })
        } else if (plan.type === 'image_url' && plan.url) {
          content.push({
            type: 'image',
            source: { type: 'url', url: plan.url },
          })
        }
      } catch (err) {
        console.error(`[Pass2V2] Failed to process plan ${url}:`, err)
      }
    }
  }

  // Text instruction
  content.push({
    type: 'text',
    text: `Generate the estimate for "${workArea.name}".
Project description: ${workArea.estimateDescription || 'No description provided'}
Remember: estimate ONLY "${workArea.name}". Do not include items for any other scope.`,
  })

  console.log(`[Pass2V2] Calling Opus for "${workArea.name}" — ${content.filter(b => b.type === 'image').length} plan images`)

  const { data, error } = await callAI<V2Pass2Response>({
    system,
    max_tokens: 8192,
    model: 'claude-opus-4-20250514',
    temperature: 0,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content }],
  })

  if (error || !data) {
    throw new Error(error ?? `Jamie could not estimate "${workArea.name}"`)
  }

  // Deduplicate line items by name + category
  const deduped: V2Pass2Response['line_items'] = []
  const seen = new Map<string, number>()
  for (const item of data.line_items ?? []) {
    const key = `${item.name.toLowerCase()}|${item.category}`
    const existingIdx = seen.get(key)
    if (existingIdx !== undefined) {
      deduped[existingIdx].qty += item.qty
      console.log(`[Pass2V2 Dedup] Merged "${item.name}": combined qty = ${deduped[existingIdx].qty}`)
    } else {
      seen.set(key, deduped.length)
      deduped.push({ ...item })
    }
  }

  // Determine mode based on gap questions
  const hasGaps = (data.gap_questions?.length ?? 0) > 0
  const mode = hasGaps ? 'mode2' as const : 'mode1' as const

  return {
    workAreaId: workArea.id,
    workAreaName: data.work_area ?? workArea.name,
    scopeDescription: data.scope_description ?? '',
    lineItems: deduped,
    reasoning: data.reasoning ?? '',
    gapQuestions: data.gap_questions ?? [],
    newCatalogItems: data.new_catalog_items ?? [],
    mode,
    rawResponse: data as unknown as Record<string, unknown>,
  }
}

// ── Run Pass 2 for all work areas sequentially ──

export async function runPass2V2(
  workAreas: Pass2V2WorkAreaInput[],
  catalog: CatalogItem[],
  productionRates: ProductionRate[],
  webSearchResultsMap?: Map<string, string>,
  onProgress?: (progress: Pass2V2Progress) => void
): Promise<Pass2V2Result[]> {
  const results: Pass2V2Result[] = []

  for (let i = 0; i < workAreas.length; i++) {
    const wa = workAreas[i]

    onProgress?.({
      completedCount: i,
      totalCount: workAreas.length,
      currentWorkAreaName: wa.name,
    })

    let result: Pass2V2Result | null = null
    const webSearchResults = webSearchResultsMap?.get(wa.id)

    // Try up to 2 attempts per work area
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await runPass2V2SingleWorkArea(wa, catalog, productionRates, webSearchResults)
        break
      } catch (err) {
        if (attempt === 0) {
          console.warn(`[Pass2V2] Retry for "${wa.name}":`, err instanceof Error ? err.message : err)
          await new Promise(r => setTimeout(r, 1500))
        } else {
          console.error(`[Pass2V2] Failed for "${wa.name}" after retry:`, err instanceof Error ? err.message : err)
        }
      }
    }

    if (result) {
      results.push(result)
      onProgress?.({
        completedCount: i + 1,
        totalCount: workAreas.length,
        currentWorkAreaName: i + 1 < workAreas.length ? workAreas[i + 1].name : wa.name,
        completedResult: result,
      })
    } else {
      // Stub for failed work area
      results.push({
        workAreaId: wa.id,
        workAreaName: wa.name,
        scopeDescription: `• ${wa.name} — Jamie could not generate line items. Add items manually.`,
        lineItems: [],
        reasoning: '',
        gapQuestions: [],
        newCatalogItems: [],
        mode: 'mode1',
        rawResponse: {},
      })
    }
  }

  return results
}
