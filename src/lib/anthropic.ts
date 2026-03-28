import { callAI } from '@/lib/supabase'
import { processPlanFile } from '@/lib/planProcessor'
import type {
  AiPass1Response,
  AiPass2Response,
  AiPass2SingleWorkAreaResponse,
  CatalogItem,
  ProductionRate,
} from '@/lib/types'

const PASS1_SYSTEM = `You are Jamie, a landscape and masonry estimating assistant trained in the Know Your Numbers (KYN) methodology by Blue Claw Group.

Based on the project plans and/or description provided, identify and list the distinct work areas for this project. Each work area is a discrete scope section that will be estimated separately.

DESCRIPTION-ONLY ESTIMATES:
When the user provides a text description without a plan or photos, you MUST still generate work areas and line items. A text description is sufficient — contractors often estimate from a conversation, not a plan.
Examples:
- "10x10 bluestone patio" → 1 work area: Bluestone Patio, 100 SF
- "Plant 5 trees and 20 shrubs along the front" → 1 work area: Landscape Planting
- "200 LF vinyl fence with 2 gates" → 1 work area: Vinyl Fence Installation
- "Driveway, front walkway, and patio" → 3 work areas: Driveway, Front Walkway, Patio
If dimensions are given (10x10), calculate the area. If not, state your assumption: "Assume [X] SF — verify with client."
NEVER return zero work areas when a description is provided. If the description mentions work, there is at least one work area.

WORK AREA NAMING RULES (mandatory):
- Every work area name must include a location descriptor unless obviously unique on the property (e.g. "Driveway", "Front Lawn", "Pool Patio").
- Use compass directions when available from plans: "Fieldstone Wall — North Perimeter"
- Use relational descriptors when compass not available: "Bluestone Patio at Rear of Residence", "Walkway from Driveway to Front Entry"
- If the plan labels areas by name (e.g. "Terrace A", "Pool Surround"), use the plan's own language.
- NEVER create duplicate generic names. Differentiate similar work areas:
  BAD: "Stone Wall" x5
  GOOD: "Fieldstone Wall — North Perimeter", "Fieldstone Wall — East Perimeter", "Fieldstone Wall — South Pool Edge"

PLAN READING RULES:
1. READ THE ENTIRE PLAN. Do not limit your analysis to what the user mentioned in the description. If the plan shows a patio, walkway, AND retaining wall, identify ALL of them as work areas — even if the user only mentioned the patio.
2. EXTRACT EXACT QUANTITIES FROM THE PLAN. If the plan labels "20 flagstones" or "150 SF" or "45 LF" — use EXACTLY that number. Do not round, estimate, or substitute your own calculation when the plan provides a specific quantity.
3. NEVER INVENT MEASUREMENTS. If the plan does not specify a dimension or quantity, do NOT fabricate one. Instead state what you CAN measure from the plan and flag what's MISSING.
4. DISTINGUISH "ON THE PLAN" vs "ASSUMED": If from plan → "(per plan)". If your assumption → "(assumed — not on plan, verify)". If calculated → "(10' x 20' per plan dimensions)".

WORK AREA DISCOVERY FROM PLANS:
When analyzing a plan, identify ALL visible work areas in two categories:
REFERENCED (mentioned in user's description): List each with confidence level and plan data.
ADDITIONAL (visible on plan but not mentioned by user): List each with a note in the description: "Also visible on plan — include?"
Default to INCLUDING all visible work areas. The user can deselect ones they don't want.

For each work area provide:
1. A clear, professional name with location descriptor per rules above
2. A one-sentence description of the scope (include source: "per plan" or "per description" or "visible on plan — include?")
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
    temperature: 0,
    messages: [{ role: 'user', content }],
  })

  if (error || !data) throw new Error(error ?? 'No response from Jamie')
  return data
}

// ── Pass 2: ISOLATED Per-Work-Area Line Item Generation (Change A + Change B) ──

function buildPass2SystemPrompt(
  workArea: { id: string; name: string; description: string },
  catalogNames: string[],
  hasPlan?: boolean
): string {
  const planBlock = hasPlan ? `
PLAN READING INSTRUCTIONS — FOLLOW THESE EXACTLY:

You have been given an uploaded project plan/drawing. Before generating
any line items, you MUST carefully examine the plan and extract ALL
information relevant to this work area.

STEP 1 — READ THE PLAN THOROUGHLY:
- Read every text label, annotation, and callout on the plan
- Read every dimension line and measurement
- Read every numbered reference and legend entry
- Identify the specific area of the plan that corresponds to this work area
- Note any materials, species, quantities, or specs mentioned

STEP 2 — EXTRACT FOR THIS WORK AREA:
For the work area named "${workArea.name}", extract:
- Dimensions (length, width, area, height, depth, diameter)
- Materials specified (stone type, paver type, plant species, etc.)
- Quantities called out (plant counts, LF of edging, SF of area, etc.)
- Construction notes (footing requirements, base prep, drainage, etc.)
- Any numbered legend references that apply to this scope

STEP 3 — STATE WHAT YOU FOUND:
In your scope_description, begin with what you extracted from the plan:
"Per the plan: [specific details found]"
This proves you read the plan and anchors your estimate in real data.

STEP 4 — IDENTIFY WHAT'S MISSING:
If critical information is NOT on the plan (e.g., wall height not shown,
material not specified, area not dimensioned), include it in gap_questions.
Only ask about what's genuinely missing — do not ask about things that
ARE on the plan.

STEP 5 — POPULATE plan_references:
List every specific detail you extracted from the plan in the plan_references
array. This is your proof that you read the plan.

IMPORTANT: If you cannot see or read the plan image, say so explicitly
in your response: "I was unable to read the uploaded plan." Do NOT
silently produce an empty estimate. Do NOT make up dimensions.
If you can see the plan, PROVE IT by citing specific details from it.

` : ''

  return `You are Jamie, a KYN-trained estimating agent for BidClaw. You are estimating ONE SPECIFIC work area in isolation. Do NOT include items for any other work area.

WORK AREA YOU ARE ESTIMATING:
Name: ${workArea.name}
Description: ${workArea.description}
ID: ${workArea.id}
${planBlock}
ISOLATION RULES (CRITICAL):
- Generate line items ONLY for "${workArea.name}". Nothing else.
- Every line item must directly belong to this work area's scope.
- Labor hours are for THIS work area only — do not combine with other areas.
- Equipment hours are for THIS work area only.
- General Conditions is for THIS work area only.
- If an item could logically appear in multiple work areas (e.g., a mini skid loader), include it here with ONLY this work area's hours.

JAMIE'S TWO-MODE ESTIMATING SYSTEM:
Before generating line items, assess your confidence level for this work area.

MODE 1 — FULL TAKEOFF (mode: "full_takeoff"):
Use when you have specific dimensions, material type, and enough detail to CALCULATE real quantities — not guess.
Examples of sufficient info:
- "940 SF paver patio" → you know area, can calculate base, sand, pavers, edging, labor
- "12 LF seat wall, 24" tall, Techo Bloc" → you know LF, height, material
- "5,000 SF sod install with 6" of loam" → you know area, depth

In Mode 1, generate:
- Complete material assembly with CALCULATED quantities (show the math in descriptions)
- Equipment with hours
- Labor hours using KYN baselines
- General Conditions
- Full scope description matching 100% to line items

MODE 2 — NEEDS INFO (mode: "needs_info"):
Use when you are MISSING critical information needed for an honest takeoff. You cannot calculate real quantities without guessing.
Examples of insufficient info:
- "Seat wall" with no height, no length, no material specified
- "Landscape lighting" with no fixture count, no run lengths
- "Fire pit" with no diameter, no material, no gas vs wood
- "Planting" with no plant list, no sizes

In Mode 2, generate:
- structured_gap_questions: targeted questions the user MUST answer
- Placeholder line items with quantity 0 and placeholder: true
- An honest scope description acknowledging pending info

ALLOWANCE MODE (mode: "allowance"):
For inherently lump-sum work areas (landscape lighting, irrigation, planting without plant list):
- Structure: Labor HR + Materials LS + key component lines
- gap_questions for the missing info
- Use mode: "allowance"

THE DECISION RULE:
"Do I have enough specific information to CALCULATE quantities — not guess, not assume, CALCULATE?"
If YES → mode: "full_takeoff"
If NO → mode: "needs_info" or "allowance"
The threshold: can you show the math? "940 SF × 1.10 waste = 1,034 SF of pavers" = Mode 1. "48 fire pit blocks" with no stated diameter = Mode 2.

SPECIAL RULE — FIRE PITS:
Do NOT list both a "Fire Pit Kit" AND individual blocks/cap stones. Ask whether it's a kit or custom-built FIRST. If insufficient info, use Mode 2.

ESTIMATING INTELLIGENCE (for Mode 1):
1. Build COMPLETE material assemblies. For pavers: pavers (+ 10% waste), polymeric sand, processed dense grade base, mason sand bedding, edge restraint, spikes, equipment. Missing even one component is a failure.
2. Equipment billed separately — cement mixer, grinder, plate compactor, excavator, skid steer, etc.
3. Labor: KYN full crew day = 27 man hours (3 men × 9 hrs). Round up if within 20%.
4. Labor baselines:
   - Paver patio: 0.20–0.38 hrs/SF
   - Stone veneer: 0.12–0.25 hrs/SF
   - Natural stone steps: 1.5–4.0 hrs/step
   - Retaining wall: 0.25–0.50 hrs/SF face
   - Planting: 0.25–0.60 hrs/plant
   - Mulch: 0.05–0.10 hrs/SF
   - Seat wall (block): 0.25–0.50 hrs/SF face
5. Always add General Conditions.

CRITICAL RULES:
- Output quantities and scope ONLY — NO pricing, NO dollar amounts.
- Match item names to contractor's catalog where possible: ${JSON.stringify(catalogNames)}
- ABSOLUTE RULE: Every material in scope_description MUST have a line item. No exceptions.
- Use professional trade language, third person imperative.

For Mode 2 structured_gap_questions, use this format:
[
  { "question": "How tall is the seat wall?", "type": "select", "options": ["18 inches", "24 inches", "36 inches", "Other"], "required": true },
  { "question": "How long is the seat wall?", "type": "number", "unit": "LF", "required": true }
]

Return ONLY valid JSON matching this structure:
{
  "id": "${workArea.id}",
  "name": "${workArea.name}",
  "mode": "full_takeoff" | "needs_info" | "allowance",
  "plan_references": ["Specific details extracted from the plan for this work area"],
  "scope_description": "Professional scope text...",
  "line_items": [
    { "id": "li_1", "name": "Item Name", "quantity": 100, "unit": "SF", "category": "Materials", "description": "One sentence crew directive.", "placeholder": false }
  ],
  "gap_questions": ["Simple string questions for contractor"],
  "structured_gap_questions": [
    { "question": "...", "type": "select|number|text", "options": ["..."], "unit": "LF", "required": true }
  ],
  "jamie_message": "What Jamie says to the contractor about what she found and what she needs (Mode 2 only)",
  "new_catalog_items": ["items NOT in contractor catalog"]
}`
}

/**
 * Estimate a SINGLE work area in isolation (Change A).
 * Called once per work area — never batched.
 * Also used by re-estimate after gap questions (Change B).
 */
export async function runPass2SingleWorkArea(
  workArea: { id: string; name: string; description: string },
  projectDescription: string,
  userCatalog: CatalogItem[],
  planFileUrls?: string[]
): Promise<AiPass2SingleWorkAreaResponse> {
  const catalogNames = userCatalog.map((i) => i.name)
  const hasPlan = planFileUrls && planFileUrls.length > 0
  const system = buildPass2SystemPrompt(workArea, catalogNames, hasPlan)

  // Build content blocks — plan images first, then text instructions
  const content: Array<Record<string, unknown>> = []

  // Add plan files as vision inputs (same pattern as Pass 1)
  if (planFileUrls && planFileUrls.length > 0) {
    for (const url of planFileUrls) {
      try {
        const plan = await processPlanFile(url)
        if (plan.type === 'image_base64' && plan.data) {
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
        } else if (plan.type === 'document_url' && plan.url) {
          content.push({
            type: 'document',
            source: { type: 'url', url: plan.url },
          })
        }
      } catch (err) {
        console.warn(`[Pass2] Could not process plan file ${url}:`, err)
      }
    }
  }

  // Add text instructions
  content.push({
    type: 'text',
    text: `Estimate this work area:\nName: ${workArea.name}\nDescription: ${workArea.description}\n\nProject context: ${projectDescription}\n\nRemember: estimate ONLY "${workArea.name}". Do not include items for any other scope.${hasPlan ? '\n\nA project plan/drawing is attached above. READ IT CAREFULLY and extract all details relevant to this work area before generating line items. Cite specific plan details in your scope_description.' : ''}`,
  })

  const { data, error } = await callAI<AiPass2SingleWorkAreaResponse>({
    system,
    max_tokens: 4000,
    model: 'claude-opus-4-20250514',
    temperature: 0,
    tools: [{ type: 'web_search', name: 'web_search', max_uses: 3 }],
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? `Jamie could not estimate "${workArea.name}"`)

  // Ensure the response has the correct work area ID
  data.id = workArea.id
  data.name = workArea.name

  // Deduplicate line items: merge items with same name AND category
  if (data.line_items && data.line_items.length > 0) {
    const seen = new Map<string, number>()
    const deduped: typeof data.line_items = []
    for (const item of data.line_items) {
      const key = `${item.name.toLowerCase()}|${item.category}`
      const existingIdx = seen.get(key)
      if (existingIdx !== undefined) {
        deduped[existingIdx].quantity += item.quantity
        console.log(`[Jamie Dedup] Merged duplicate "${item.name}" (${item.category}): combined qty = ${deduped[existingIdx].quantity}`)
      } else {
        seen.set(key, deduped.length)
        deduped.push({ ...item })
      }
    }
    data.line_items = deduped
  }

  return data
}

// ── Progress callback type ──
export interface Pass2Progress {
  completedCount: number
  totalCount: number
  currentWorkAreaName: string
  completedWorkArea?: AiPass2SingleWorkAreaResponse
}

/**
 * Run Pass2 for all work areas, one at a time, with progress callbacks.
 * Each work area gets its own isolated API call (Change A). If one fails,
 * it retries that single work area (up to 1 retry) before moving on.
 * Completed work areas are delivered incrementally via the onProgress callback.
 */
export async function runPass2(
  approvedWorkAreas: { id: string; name: string; description: string }[],
  projectDescription: string,
  userCatalog: CatalogItem[],
  _productionRates: ProductionRate[],
  gapAnswers?: Record<string, string>,
  _webSearchContext?: string,
  onProgress?: (progress: Pass2Progress) => void,
  _manualMode?: boolean,
  planFileUrls?: string[]
): Promise<AiPass2Response> {
  const completedWorkAreas: AiPass2SingleWorkAreaResponse[] = []

  for (let i = 0; i < approvedWorkAreas.length; i++) {
    const wa = approvedWorkAreas[i]

    // Report progress — starting this work area
    onProgress?.({
      completedCount: i,
      totalCount: approvedWorkAreas.length,
      currentWorkAreaName: wa.name,
    })

    let result: AiPass2SingleWorkAreaResponse | null = null

    // Build enriched description with gap answers if available
    let enrichedWa = wa
    if (gapAnswers && Object.keys(gapAnswers).length > 0) {
      const answersBlock = Object.entries(gapAnswers)
        .map(([q, a]) => `Q: ${q}\nA: ${a}`)
        .join('\n\n')
      enrichedWa = {
        ...wa,
        description: `${wa.description}\n\nCONTRACTOR ANSWERED THESE QUESTIONS:\n${answersBlock}`,
      }
    }

    // Try up to 2 attempts per work area
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await runPass2SingleWorkArea(enrichedWa, projectDescription, userCatalog, planFileUrls)
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
        mode: 'full_takeoff',
        scope_description: `• ${wa.description || wa.name} — Jamie could not generate line items for this work area. Add items manually.`,
        line_items: [],
        gap_questions: [],
        structured_gap_questions: [],
        new_catalog_items: [],
      })
    }
  }

  return {
    work_areas: completedWorkAreas.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      plan_references: r.plan_references,
      jamie_message: r.jamie_message,
      scope_description: r.scope_description,
      line_items: r.line_items,
      gap_questions: r.gap_questions,
      structured_gap_questions: r.structured_gap_questions,
      new_catalog_items: r.new_catalog_items,
    })),
  }
}
