// ============================================================
// V2 Pass 1 — Jamie reads ALL plans via Opus
// Full extraction: dimensions, materials, quantities, annotations,
// areas/zones, existing conditions, scale, unknowns.
// Returns structured JSON stored in estimates.pass1_extraction.
// ============================================================

import { callAI } from '@/lib/supabase'
import { rasterizeAllPDFPages } from '@/lib/planProcessor'
import type { V2Pass1Extraction } from '@/lib/types'

const PASS1_V2_SYSTEM = `You are Jamie, an expert construction estimator with decades of
experience in landscaping, masonry, hardscape, pools, and related
trades. You are reading project plans for the first time.

You have FOUR jobs:

STEP 1 — EXTRACT EVERYTHING

Read every plan sheet and photo. Extract every measurement, material
callout, plant count, annotation, area, and note you can see. Be
thorough — miss nothing. If something is unclear, flag it as an
unknown. Do NOT guess.

Extract:
1. DIMENSIONS — Every measurement. Length, width, area, diameter,
   depth, height. Include the unit and what it refers to.
2. MATERIALS — Every material called out. Stone type, paver brand/color,
   plant species, mulch type, gravel spec, concrete mix, fence material.
3. QUANTITIES — Every count. Plant schedule, material schedule, fixture
   counts, step counts. Extract completely.
4. ANNOTATIONS — Every text note, callout, label, dimension line,
   grade elevation, utility marker, or written instruction.
5. AREAS AND ZONES — Every defined area or zone. Lawn areas, planting
   beds, patio zones, pool deck, driveway, walkways.
6. EXISTING CONDITIONS — Anything marked as existing: trees to remain,
   structures, utilities, demo areas.
7. SCALE — If a scale bar or scale reference is visible, note it.
8. UNKNOWNS — If something is unclear, illegible, or ambiguous, flag it
   explicitly. Do NOT guess.

STEP 2 — PROPOSE WORK AREAS

Based on your extraction, propose logical work area groupings. Think
like an estimator organizing a bid: what are the distinct scopes of work?

Group related items together:
- Bluestone patio + edging + base materials → "Patio"
- All plants + mulch + soil → "Planting"
- Driveway surface + edging + base → "Driveway"
- Retaining wall + drainage + cap → "Retaining Wall"
- Steps + treads + risers → "Steps"

Each work area should be a complete scope that a crew would execute
together. Don't split things that naturally go together. Don't combine
things that would be bid separately.

For each work area, write a one-sentence summary referencing specific
items from the plan.

STEP 3 — ASK YOUR QUESTIONS

Look at your extraction and proposed work areas. For each work area,
ask yourself: do I have enough information to build a complete estimate?
If not, what specific information am I missing?

Generate questions ONLY for things you genuinely cannot determine from
the plans. Good questions:
- "The plan shows a retaining wall but doesn't dimension the height.
   How tall?" (can't see it)
- "I see a fire pit area but no material spec. Gas or wood-burning?"
   (material choice affects the estimate)

Bad questions (don't ask these):
- "What kind of stone for the patio?" (if the plan says bluestone,
   you already know)
- "How big is the patio?" (if dimensions are on the plan, you
   already measured it)

Where possible, provide answer options so the user can tap rather
than type. For dimensions, provide common values plus a custom option.

STEP 4 — EXTRACT CLIENT INFO

Check plan title blocks, site plan headers, and project info blocks
for: property address, client name, project name. Capture anything
you find.

CONFIDENCE RATING:
- "high" = clear dimensions, labeled materials, readable annotations
- "medium" = some dimensions visible but gaps exist
- "low" = conceptual sketch, photos only, or largely illegible

Return ONLY valid JSON matching this structure:
{
  "plans_analyzed": 3,
  "confidence": "high",
  "dimensions": [
    {"item": "Patio", "value": "12' × 8'", "unit": "SF", "calculated_area": 96}
  ],
  "materials": [
    {"item": "Bluestone", "spec": "Cut Thermal, 24×36 pattern", "location": "Main patio"}
  ],
  "quantities": [
    {"item": "Limelight Hydrangea", "count": 10, "size": "#3 container"}
  ],
  "annotations": [
    {"text": "Match existing grade", "location": "South side of patio"}
  ],
  "areas_zones": [
    {"name": "Main Patio", "approx_sf": 450, "notes": "Connects to pool deck"}
  ],
  "existing_conditions": [
    {"item": "Oak tree", "note": "Protect — do not disturb root zone"}
  ],
  "scale": "1 inch = 10 feet",
  "unknowns": [
    {"item": "Retaining wall height", "note": "Not dimensioned on plan"}
  ],
  "proposed_work_areas": [
    {
      "name": "Patio",
      "summary": "Bluestone Cut Thermal patio, 12' × 8', with cobblestone edging",
      "relevant_extraction": ["Bluestone patio 12x8", "Cobblestone edging 40 LF"],
      "confidence": "high"
    }
  ],
  "questions": [
    {
      "question": "I see a retaining wall in the slope but can't determine the height from the plans. How tall is it?",
      "options": ["18\\"", "24\\"", "36\\"", "48\\"+"],
      "allow_custom": true,
      "relates_to_work_area": "Retaining Wall"
    }
  ],
  "client_info_found": {
    "address": "49 Doane Rd",
    "city": null,
    "state": null,
    "client_name": null,
    "project_name": "Smith Residence Landscape",
    "notes": "Property address visible on site plan title block"
  }
}

No preamble. No markdown. No explanation. JSON only.
Do NOT make up information not visible on the plans.
Extract ONLY what you can actually see.`

/**
 * Rasterize a plan file (PDF or image) into base64 image blocks
 * suitable for the Opus API call.
 */
async function preparePlanImages(
  fileUrl: string,
  fileName: string
): Promise<{ images: Array<{ base64: string; mediaType: string }>; text: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const images: Array<{ base64: string; mediaType: string }> = []
  let text = ''

  if (ext === 'pdf') {
    // Rasterize ALL pages
    try {
      const pages = await rasterizeAllPDFPages(fileUrl)
      for (const page of pages) {
        images.push({ base64: page.base64, mediaType: 'image/jpeg' })
      }
      console.log(`[Pass1V2] Rasterized ${pages.length} pages from ${fileName}`)
    } catch (err) {
      console.error(`[Pass1V2] Failed to rasterize ${fileName}:`, err)
      // Try fetching as buffer
      try {
        const response = await fetch(fileUrl)
        if (response.ok) {
          const { rasterizeAllPDFPagesFromBuffer } = await import('@/lib/planProcessor')
          const buf = await response.arrayBuffer()
          const pages = await rasterizeAllPDFPagesFromBuffer(buf)
          for (const page of pages) {
            images.push({ base64: page.base64, mediaType: 'image/jpeg' })
          }
        }
      } catch (err2) {
        console.error(`[Pass1V2] Buffer fallback also failed for ${fileName}:`, err2)
      }
    }
  } else if (['png', 'jpg', 'jpeg', 'webp', 'tiff'].includes(ext)) {
    // Fetch image and convert to base64
    try {
      const response = await fetch(fileUrl)
      if (response.ok) {
        const blob = await response.blob()
        const buffer = await blob.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        const mediaType = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg')
        images.push({ base64, mediaType })
        console.log(`[Pass1V2] Loaded image ${fileName}: ${(base64.length / 1024).toFixed(0)} KB`)
      }
    } catch (err) {
      console.error(`[Pass1V2] Failed to load image ${fileName}:`, err)
    }
  }

  return { images, text }
}

export interface Pass1V2Input {
  estimateName: string | null
  firstName: string
  lastName: string
  addressLine: string
  city: string
  state: string
  zip: string
  projectType: string | null
  projectDescription: string | null
  plans: Array<{ file_path: string; file_name: string }>
  /** v3: optional user context from Screen 1 ("just the patio" or "full site") */
  userContext?: string | null
}

export interface Pass1V2Result {
  extraction: V2Pass1Extraction
  confidence: 'high' | 'medium' | 'low'
}

/**
 * V2 Pass 1: Send ALL plan images to Opus for full extraction.
 * Returns structured extraction JSON.
 */
export async function runPass1V2(input: Pass1V2Input): Promise<Pass1V2Result> {
  const content: Array<Record<string, unknown>> = []

  // Rasterize all plan files and add as image blocks
  for (const plan of input.plans) {
    const { images } = await preparePlanImages(plan.file_path, plan.file_name)
    for (const img of images) {
      if (img.base64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        })
      }
    }
  }

  // Add project context as final text block
  const contextParts: string[] = []
  if (input.estimateName) contextParts.push(`Project: ${input.estimateName}`)
  if (input.firstName || input.lastName) contextParts.push(`Client: ${input.firstName} ${input.lastName}`.trim())
  if (input.addressLine) contextParts.push(`Address: ${input.addressLine}, ${input.city}, ${input.state} ${input.zip}`)
  if (input.projectType) contextParts.push(`Type: ${input.projectType}`)
  if (input.projectDescription) contextParts.push(`Description: ${input.projectDescription}`)
  if (input.userContext) contextParts.push(`Contractor's note: ${input.userContext}`)

  content.push({
    type: 'text',
    text: contextParts.length > 0
      ? `Read these plans and extract everything.\n\n${contextParts.join('\n')}`
      : 'Read these plans and extract everything.',
  })

  console.log(`[Pass1V2] Sending ${content.filter(b => b.type === 'image').length} image blocks to Opus`)

  const { data, error } = await callAI<V2Pass1Extraction>({
    system: PASS1_V2_SYSTEM,
    max_tokens: 8192,
    model: 'claude-opus-4-20250514',
    temperature: 0,
    messages: [{ role: 'user', content }],
  })

  if (error || !data) {
    throw new Error(error ?? 'Jamie could not read the plans')
  }

  return {
    extraction: data,
    confidence: data.confidence,
  }
}
