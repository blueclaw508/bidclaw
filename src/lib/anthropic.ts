import { callAI } from '@/lib/supabase'
import { processPlanFile } from '@/lib/planProcessor'
import { buildUnifiedEstimatePrompt, crossValidateScopeAndItems } from '@/lib/jamiePrompt'
import type { KYNRates } from '@/lib/jamiePrompt'
import type { AiPass1Response, AiPass2Response, CatalogItem, ProductionRate } from '@/lib/types'

const PASS1_SYSTEM = `You are Jamie, a landscape and masonry estimating assistant trained in the Know Your Numbers (KYN) methodology by Blue Claw Group.

Based on the project plans and description provided, identify and list the distinct work areas for this project. Each work area is a discrete scope section that will be estimated separately.

WORK AREA NAMING RULES (mandatory):
- Every work area name must include a location descriptor unless obviously unique on the property (e.g. "Driveway", "Front Lawn", "Pool Patio").
- Use compass directions when available from plans: "Fieldstone Wall — North Perimeter"
- Use relational descriptors when compass not available: "Bluestone Patio at Rear of Residence", "Walkway from Driveway to Front Entry"
- If the plan labels areas by name (e.g. "Terrace A", "Pool Surround"), use the plan's own language.
- NEVER create duplicate generic names. Differentiate similar work areas:
  BAD: "Stone Wall" x5
  GOOD: "Fieldstone Wall — North Perimeter", "Fieldstone Wall — East Perimeter", "Fieldstone Wall — South Pool Edge"

For each work area provide:
1. A clear, professional name with location descriptor per rules above
2. A one-sentence description of the scope
3. A complexity rating: Simple | Moderate | Complex
4. gap_questions: 2-4 clarifying questions you need answered BEFORE you can build accurate line items for this work area. Ask about things the description doesn't cover: substrate type, disposal scope, site access, material preferences, equipment owned vs. rental, existing conditions, Nantucket vs. mainland pricing. If the description is detailed enough that you have no questions, return an empty array.

Return ONLY valid JSON. No preamble, no explanation outside the JSON structure:
{
  "work_areas": [
    {
      "id": "wa_1",
      "name": "Work Area Name with Location",
      "description": "Brief scope description",
      "complexity": "Moderate",
      "gap_questions": ["Is this on wood framing or CMU block?", "Is demolition/haul-off included?"]
    }
  ]
}`

export async function runPass1(
  projectName: string,
  projectAddress: string,
  projectDescription: string,
  planFileUrls: string[]
): Promise<AiPass1Response> {
  const content: Array<Record<string, unknown>> = []

  // Process each plan file — auto-detects raster vs text PDFs
  for (const url of planFileUrls) {
    const plan = await processPlanFile(url)

    if (plan.type === 'image_base64' && plan.data) {
      // Raster PDF — converted to JPEG, send as base64 image for vision
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: plan.mediaType ?? 'image/jpeg',
          data: plan.data,
        },
      })
    } else if (plan.type === 'image_url' && plan.url) {
      // Non-PDF image (JPG, PNG, WebP, TIFF) — pass URL directly
      content.push({
        type: 'image',
        source: { type: 'url', url: plan.url },
      })
    } else if (plan.type === 'document_url' && plan.url) {
      // Text-based PDF — use document URL (Claude text extraction)
      content.push({
        type: 'document',
        source: { type: 'url', url: plan.url },
      })
    }
  }

  content.push({
    type: 'text',
    text: `Project: ${projectName}\nAddress: ${projectAddress}\nDescription: ${projectDescription}`,
  })

  const { data, error } = await callAI<AiPass1Response>({
    system: PASS1_SYSTEM,
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  })

  if (error || !data) throw new Error(error ?? 'No response from Jamie')
  return data
}

// ── Pass2 Single Work Area ──
// Estimates one work area at a time for incremental rendering and resumable retries.

import type { AiPass2WorkArea } from '@/lib/types'

const PASS2_SINGLE_SUFFIX = `Return a single work area JSON object (NOT wrapped in an array):
{
  "id": "wa_1",
  "name": "Front Entry Walkway",
  "scope_description": "• Install approximately 120 SF of irregular bluestone walkway at front entry per site visit.\\n• Approx. 120 SF walkway area.\\n• Excavate and remove existing material to depth of 10\\".\\n• Install and compact 6\\" processed gravel base.\\n• Install bluestone pavers on compacted base.\\n• Sweep polymeric sand into joints and compact.\\n• Install edge restraint at perimeter.",
  "line_items": [
    {
      "id": "li_1",
      "name": "Bluestone Irregular",
      "quantity": 120,
      "unit": "SF",
      "category": "Materials",
      "description": "Supply irregular bluestone pavers for walkway installation."
    }
  ],
  "gap_questions": ["Is this on an existing gravel base or new construction?"],
  "new_catalog_items": ["Polymeric Sand"]
}`

async function runPass2Single(
  workArea: { id: string; name: string; description: string },
  projectDescription: string,
  systemPrompt: string,
  gapAnswers?: Record<string, string>,
): Promise<AiPass2WorkArea> {
  let userContent = `Estimate this single work area:\n${JSON.stringify(workArea)}\n\nProject context: ${projectDescription}`

  if (gapAnswers && Object.keys(gapAnswers).length > 0) {
    const answersBlock = Object.entries(gapAnswers)
      .map(([q, a]) => `Q: ${q}\nA: ${a}`)
      .join('\n\n')
    userContent += `\n\nCONTRACTOR ANSWERED THESE QUESTIONS:\n${answersBlock}\nUse these answers when building line items. Do not ask these questions again.`
  }

  const { data, error } = await callAI<AiPass2WorkArea>({
    system: systemPrompt,
    max_tokens: 4000,
    messages: [{ role: 'user', content: userContent }],
  })

  if (error || !data) throw new Error(error ?? 'No response from Jamie')

  // Ensure the id matches what we sent
  data.id = workArea.id

  // Cross-validate
  if (data.scope_description && data.line_items) {
    crossValidateScopeAndItems(data.scope_description, data.line_items)
  }

  return data
}

// ── Progress callback type ──
export interface Pass2Progress {
  completedCount: number
  totalCount: number
  currentWorkAreaName: string
  completedWorkArea?: AiPass2WorkArea
}

/**
 * Run Pass2 for all work areas, one at a time, with progress callbacks.
 * Each work area gets its own API call. If one fails, it retries that single
 * work area (up to 1 retry) before moving on. Completed work areas are
 * delivered incrementally via the onProgress callback.
 */
export async function runPass2(
  approvedWorkAreas: { id: string; name: string; description: string }[],
  projectDescription: string,
  userCatalog: CatalogItem[],
  productionRates: ProductionRate[],
  kynRates: KYNRates,
  gapAnswers?: Record<string, string>,
  webSearchContext?: string,
  onProgress?: (progress: Pass2Progress) => void,
  manualMode?: boolean
): Promise<AiPass2Response> {
  const basePrompt = buildUnifiedEstimatePrompt({
    catalog: userCatalog,
    productionRates,
    kynRates,
  })

  const searchBlock = webSearchContext ? `\n\n${webSearchContext}\n` : ''

  const manualBlock = manualMode
    ? `\n\nTHE CONTRACTOR HAS DEFINED THESE WORK AREAS. Estimate each one exactly as named. Do not add work areas. Do not combine work areas. Do not skip any. Build a complete line item set for each one listed:\n${approvedWorkAreas.map((wa) => `- ${wa.name}`).join('\n')}\n`
    : ''

  const systemPrompt = `${basePrompt}${searchBlock}${manualBlock}

You are estimating a SINGLE work area. Return scope_description and line_items generated TOGETHER.

For the work area return:
- scope_description: Bullet list (• character) per the SCOPE FORMAT rules above. Must match line_items 100%.
- line_items: Complete list with id, name, quantity, unit, category, description
- gap_questions: 2-4 questions to confirm with the contractor (site conditions, material preferences, access)
- new_catalog_items: item names that are NOT in the contractor's catalog

For each line item include:
- id: unique identifier (e.g. "li_1")
- name: item name (match catalog names exactly where possible)
- quantity: numeric quantity
- unit: SF | LF | CY | SY | EA | LS | HR | Day | Allow
- category: Materials | Labor | Equipment | Subcontractor | Disposal
- description: one precise sentence describing this line item's scope (crew-directive style)

${PASS2_SINGLE_SUFFIX}`

  const completedWorkAreas: AiPass2WorkArea[] = []

  for (let i = 0; i < approvedWorkAreas.length; i++) {
    const wa = approvedWorkAreas[i]

    // Report progress — starting this work area
    onProgress?.({
      completedCount: i,
      totalCount: approvedWorkAreas.length,
      currentWorkAreaName: wa.name,
    })

    let result: AiPass2WorkArea | null = null

    // Try up to 2 attempts per work area
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await runPass2Single(wa, projectDescription, systemPrompt, gapAnswers)
        break
      } catch (err) {
        if (attempt === 0) {
          console.warn(`[Pass2] Retry for "${wa.name}":`, err instanceof Error ? err.message : err)
          await new Promise((r) => setTimeout(r, 1500))
        } else {
          console.error(`[Pass2] Failed for "${wa.name}" after retry:`, err instanceof Error ? err.message : err)
        }
      }
    }

    if (result) {
      completedWorkAreas.push(result)

      // Report progress — work area completed
      onProgress?.({
        completedCount: i + 1,
        totalCount: approvedWorkAreas.length,
        currentWorkAreaName: i + 1 < approvedWorkAreas.length
          ? approvedWorkAreas[i + 1].name
          : wa.name,
        completedWorkArea: result,
      })
    } else {
      // Work area failed even after retry — create a stub so the estimate isn't incomplete
      completedWorkAreas.push({
        id: wa.id,
        name: wa.name,
        scope_description: `• ${wa.description || wa.name} — Jamie could not generate line items for this work area. Add items manually.`,
        line_items: [],
        gap_questions: [],
        new_catalog_items: [],
      })
    }
  }

  return { work_areas: completedWorkAreas }
}
