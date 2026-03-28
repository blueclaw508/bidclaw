// Jamie — BidClaw's Estimating Agent
// Powered by Anthropic Claude, trained in KYN methodology

import { callAI } from '@/lib/supabase'
import { buildUnifiedEstimatePrompt } from '@/lib/jamiePrompt'
import type { WorkAreaData, LineItemData, CatalogItem, ProductionRate } from '@/lib/types'

// ── Jamie Conversational System Prompt (intake, review, summary — NOT estimate generation) ──
const JAMIE_CONVERSATIONAL = `You are Jamie, the estimating agent for BidClaw — a landscape and masonry estimating tool by Blue Claw Group.

You sound like an experienced landscaping estimator, not a generic chatbot. Short, direct questions. Professional and trade-savvy. No jargon overload.

BidClaw is a quantity and scope tool ONLY. It collects:
- Quantities (SF, CY, LF, EA, hours)
- Material costs (what the contractor pays — no markup)
- Sub costs (what subs charge — no markup)
- Equipment items and hours (no rates)
- Labor man hours (no rates, no burden)

BidClaw NEVER calculates or discusses: labor burden, overhead, profit margin, markups, retail labor rate, RPR, or any pricing totals. All of that lives in QuickCalc.

You reference the user's own catalog items and production rates for quantities only.`

// ── Conversational Intake ──

export interface JamieMessage {
  role: 'jamie' | 'user'
  content: string
}

const INTAKE_QUESTIONS = [
  "What type of project is this — new construction, renovation, or maintenance?",
  "Is this a residential or commercial property?",
  "Roughly how many square feet are we working with, or what's the site size?",
  "Any site conditions I should know about — slopes, access restrictions, existing structures?",
  "What's the timeline expectation from the client?",
  "Any special materials or design requirements the client has mentioned?",
]

export function getNextIntakeQuestion(messages: JamieMessage[]): string | null {
  const userAnswers = messages.filter((m) => m.role === 'user').length
  if (userAnswers < INTAKE_QUESTIONS.length) {
    return INTAKE_QUESTIONS[userAnswers]
  }
  return null
}

export function isIntakeComplete(messages: JamieMessage[]): boolean {
  return messages.filter((m) => m.role === 'user').length >= INTAKE_QUESTIONS.length
}

export function buildIntakeContext(messages: JamieMessage[]): string {
  const pairs: string[] = []
  const questions = messages.filter((m) => m.role === 'jamie')
  const answers = messages.filter((m) => m.role === 'user')
  for (let i = 0; i < answers.length; i++) {
    pairs.push(`Q: ${questions[i]?.content ?? INTAKE_QUESTIONS[i]}\nA: ${answers[i].content}`)
  }
  return pairs.join('\n\n')
}

// ── Jamie Build Estimate from Intake ──

export interface JamieBuildResult {
  work_areas: WorkAreaData[]
  line_items: Record<string, LineItemData[]>
  scope_descriptions: Record<string, string>
}

export async function jamieBuildEstimate(
  intakeContext: string,
  clientName: string,
  projectAddress: string,
  userCatalog: CatalogItem[],
  productionRates: ProductionRate[],
): Promise<JamieBuildResult> {
  const basePrompt = buildUnifiedEstimatePrompt({
    catalog: userCatalog,
    productionRates,
  })

  const { data, error } = await callAI<JamieBuildResult>({
    model: 'claude-opus-4-20250514',
    temperature: 0,
    system: `${basePrompt}

You are building an estimate from a job intake conversation. Generate work areas with UNIFIED scope descriptions and line items.

WORK AREA NAMING RULES:
- Every work area name must include a location descriptor unless obviously unique (e.g. "Driveway")
- Use compass directions when known: "Fieldstone Wall — North Perimeter"
- Use relational descriptors otherwise: "Bluestone Patio at Rear of Residence"
- If plan labels areas by name, use plan terminology
- Differentiate similar items: never "Stone Wall" x5 — always include location

Return ONLY valid JSON:
{
  "work_areas": [
    { "id": "wa_1", "name": "Area Name with Location", "description": "Brief scope", "complexity": "Moderate", "approved": false }
  ],
  "line_items": {
    "wa_1": [
      { "id": "li_1", "name": "Item Name", "quantity": 100, "unit": "SF", "category": "Materials", "description": "Scope line" }
    ]
  },
  "scope_descriptions": {
    "wa_1": "• Line 1\\n• Line 2\\n• Line 3..."
  }
}`,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Client: ${clientName}\nAddress: ${projectAddress}\n\nJob Intake Interview:\n${intakeContext}`,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? 'Jamie could not build the estimate')

  return data
}

// ── Unified Scope + Line Items Writer (per work area) ──
// Prime Directive: scope and line items are ALWAYS generated together.

export interface JamieScopeResult {
  scope_description: string
  line_items: LineItemData[]
}

// Exported for future use in Jamie's scope generation prompt
export const NOTES_FORMAT_PROMPT = `Write scope notes for a work area using this EXACT bullet format. These notes serve as both the client proposal AND the crew field directive.

MANDATORY FORMAT (every line is a bullet using the • character):
• [Line 1] One sentence: what is being installed, where on the property, and per what spec (plan or site visit).
• [Line 2] Overall size or quantity of the work area.
• [Line 3] Material specified — manufacturer, product name, color if known. Skip if no specific material.
• [Lines 4+] Step-by-step work sequence. One bullet per step. Written as crew instructions — precise enough to hold up as a field directive.
• [Last line] "Disposal Fees Included." — ONLY when demolition or removal is involved.

CRITICAL RULES:
- Every single line = one bullet point (•)
- No asterisks (*) — bullets (•) only
- No numbered lists
- No plain unformatted lines
- No headers within notes
- No salesy language — pure scope description
- Written in third person imperative ("Install..." not "We will install...")
- Precise enough that a crew could execute from this document alone
- The location in Line 1 must match the work area name

EXAMPLE — Paver Patio:
• Install new EP Henry Cambridge paver patio at rear of residence per site visit.
• Approx. 890 SF patio area.
• EP Henry Cambridge Cobble, color: Toffee Onyx.
• Excavate and remove existing lawn area to depth of 10".
• Install and compact 6" processed gravel base.
• Install 1" bedding sand and screed to grade.
• Install pavers per pattern specified.
• Sweep polymeric sand into joints and compact.
• Install aluminum edge restraint at perimeter.
• Disposal Fees Included.

EXAMPLE — Loam & Sod:
• Install new lawn area at rear of residence per site visit.
• Approx. 1,430 SF lawn area.
• Premium sod, species per site conditions.
• Fine grade existing subgrade and remove construction debris from lawn areas.
• Deliver and spread 27 CY of premium loam at 6" depth.
• Fine grade and roll loam to smooth, even finish.
• Install sod in staggered pattern per standard practice.
• Roll sod upon completion.
• Water all sod thoroughly upon installation.
• Disposal Fees Included.

EXAMPLE — Mulch:
• Install new mulch to existing planting beds per site visit.
• Approx. 19 CY mulch to existing bed areas.
• Shredded bark mulch, color to match existing.
• Edge all bed perimeters prior to mulch installation.
• Deliver and spread 19 CY shredded bark mulch at 3" depth throughout existing beds.
• Hand rake to uniform finish.
• Clean all hard surfaces upon completion.

EXAMPLE — Planting:
• Install all new plant material per Planting Plan L3 prepared by Summerland Homes & Gardens dated February 2, 2026.
• Approx. 7 trees, 89 shrubs, and 89 perennials per plant list.
• All plant material per species and quantities specified on plan.
• Prepare all planting bed areas — cultivate soil and remove debris.
• Deliver and incorporate soil amendments into planting beds per plan.
• Install all trees, shrubs, and perennials per plan at correct finish grade.
• Stake all trees and large evergreens per standard practice.
• Water all plant material thoroughly upon installation.
• Apply anti-desiccant to all plants at planting time.
• Contractor to provide one-year guarantee on all plant material.

SPEC SOURCE LANGUAGE for Line 1:
- If plan was uploaded → "per [Plan Name] prepared by [Designer] dated [Date]"
- If no plan → "per site visit"
- If dimensions were manually entered → "per site measurements"`

export async function jamieWriteScope(
  workAreaName: string,
  lineItems: LineItemData[],
  userCatalog: CatalogItem[],
  productionRates: ProductionRate[],
  projectDescription?: string,
  planUploaded?: boolean
): Promise<JamieScopeResult> {
  const basePrompt = buildUnifiedEstimatePrompt({
    catalog: userCatalog,
    productionRates,
  })

  const itemsSummary = lineItems.map((li) => `${li.name}: ${li.quantity} ${li.unit} (${li.category})`).join('\n')

  const { data, error } = await callAI<{ scope_description: string; line_items: LineItemData[] }>({
    model: 'claude-opus-4-20250514',
    temperature: 0.3,
    system: `${basePrompt}

You are rewriting the scope and line items for a single work area. The user has existing line items — use them as a starting point but apply the Prime Directive: if you add something to the scope, add a line item. If you remove something from the scope, remove the line item.

SPEC SOURCE LANGUAGE for the first bullet:
- If plan was uploaded → "per project plans"
- If no plan → "per site visit"

Return ONLY valid JSON:
{
  "scope_description": "• Line 1\\n• Line 2\\n...",
  "line_items": [
    { "id": "li_1", "name": "Item Name", "quantity": 100, "unit": "SF", "category": "Materials", "description": "Scope line" }
  ]
}`,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Work Area: ${workAreaName}\n\nExisting Line Items:\n${itemsSummary}${projectDescription ? `\n\nProject Description: ${projectDescription}` : ''}${planUploaded ? '\n\nNote: Plans were uploaded for this project.' : ''}`,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? 'Jamie could not write scope')

  return {
    scope_description: data.scope_description,
    line_items: data.line_items,
  }
}

// ── Estimate Narrative / Summary ──

export async function jamieGenerateSummary(
  clientName: string,
  projectAddress: string,
  workAreas: WorkAreaData[],
  lineItems: Record<string, LineItemData[]>
): Promise<string> {
  const wasSummary = workAreas.map((wa) => {
    const items = lineItems[wa.id] ?? []
    return `${wa.name} (${wa.complexity}): ${items.length} line items`
  }).join('\n')

  const { data, error } = await callAI<{ summary: string }>({
    model: 'claude-opus-4-20250514',
    temperature: 0.3,
    system: `${JAMIE_CONVERSATIONAL}

Write a professional estimate introduction paragraph for a client proposal. Include:
1. A brief project overview
2. A scope summary referencing the work areas
3. A closing confidence statement

Tone: professional, confident, experienced — like a seasoned contractor who knows their numbers. 3-5 sentences.

Return ONLY valid JSON: { "summary": "..." }`,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Client: ${clientName}\nAddress: ${projectAddress}\n\nWork Areas:\n${wasSummary}`,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? 'Jamie could not generate summary')
  return data.summary
}

// ── Estimate Analyzer (quantity & completeness checks ONLY) ──
// BidClaw NEVER warns about pricing, markups, rates, RPR, or costs.
// Those belong in QuickCalc. Jamie only checks estimate completeness.

export interface JamieAnalysisItem {
  line_item_name: string
  work_area: string
  status: 'ok' | 'warning'
  message: string
}

export interface JamieAnalysisResult {
  overall_status: 'ok' | 'warning'
  summary: string
  items: JamieAnalysisItem[]
}

export function jamieAnalyzeEstimate(
  workAreas: WorkAreaData[],
  lineItems: Record<string, LineItemData[]>,
): JamieAnalysisResult {
  // Real validation — catches garbage data, not just missing fields
  const warnings: JamieAnalysisItem[] = []

  // Track all item names across work areas for duplicate detection
  const globalItemMap: Map<string, string[]> = new Map()

  for (const wa of workAreas) {
    const items = lineItems[wa.id] ?? []
    const waNameLower = wa.name.toLowerCase()

    // ── Empty work area ──
    if (items.length === 0) {
      warnings.push({
        line_item_name: wa.name,
        work_area: wa.name,
        status: 'warning',
        message: 'This work area has no line items — Jamie may need more info.',
      })
      continue
    }

    // ── All-placeholder check (every qty is 0) ──
    const allZero = items.every((li) => !li.quantity || li.quantity <= 0)
    if (allZero) {
      warnings.push({
        line_item_name: wa.name,
        work_area: wa.name,
        status: 'warning',
        message: 'All quantities are zero — Jamie needs dimensions or specs to calculate.',
      })
    }

    // ── Missing labor line ──
    const hasLabor = items.some((li) => li.category === 'Labor')
    const hasMaterials = items.some((li) => li.category === 'Materials')
    if (hasMaterials && !hasLabor) {
      warnings.push({
        line_item_name: 'Labor',
        work_area: wa.name,
        status: 'warning',
        message: `${wa.name} has materials but no labor line — who installs it?`,
      })
    }

    // ── Missing General Conditions ──
    const hasGC = items.some((li) =>
      li.name.toLowerCase().includes('general conditions') ||
      li.name.toLowerCase().includes('rounding')
    )
    if (!hasGC && items.length > 2) {
      warnings.push({
        line_item_name: 'General Conditions',
        work_area: wa.name,
        status: 'warning',
        message: `${wa.name} is missing a General Conditions / Rounding line.`,
      })
    }

    for (const li of items) {
      // Track for cross-area duplicates
      const normalName = li.name.toLowerCase().trim()
      if (!globalItemMap.has(normalName)) globalItemMap.set(normalName, [])
      globalItemMap.get(normalName)!.push(wa.name)

      // ── Missing quantity ──
      if (!li.quantity || li.quantity <= 0) {
        if (!li.placeholder) {
          warnings.push({
            line_item_name: li.name,
            work_area: wa.name,
            status: 'warning',
            message: `Missing quantity on "${li.name}".`,
          })
        }
        continue // Skip range checks on zero-qty items
      }

      // ── Unreasonably small quantities by work type ──
      const qty = li.quantity
      const unitLower = (li.unit || '').toLowerCase()
      const nameLower = li.name.toLowerCase()

      // Patio / walkway area checks
      if (
        (waNameLower.includes('patio') || waNameLower.includes('walkway')) &&
        (unitLower === 'sf' || unitLower === 'sq ft') &&
        (nameLower.includes('paver') || nameLower.includes('bluestone') || nameLower.includes('stone') || nameLower.includes('porcelain'))
      ) {
        if (qty < 50) {
          warnings.push({
            line_item_name: li.name,
            work_area: wa.name,
            status: 'warning',
            message: `${qty} SF is unusually small for a ${wa.name}. Verify dimensions.`,
          })
        }
      }

      // Wall length checks
      if (
        (waNameLower.includes('wall') || waNameLower.includes('seat wall')) &&
        (unitLower === 'lf' || unitLower === 'lin ft') &&
        (nameLower.includes('wall') || nameLower.includes('block') || nameLower.includes('cap'))
      ) {
        if (qty < 3) {
          warnings.push({
            line_item_name: li.name,
            work_area: wa.name,
            status: 'warning',
            message: `${qty} LF is unusually short for a wall. Verify length.`,
          })
        }
      }

      // Wall SF face checks
      if (
        waNameLower.includes('wall') &&
        unitLower === 'sf' &&
        (nameLower.includes('veneer') || nameLower.includes('stone') || nameLower.includes('block'))
      ) {
        if (qty < 10) {
          warnings.push({
            line_item_name: li.name,
            work_area: wa.name,
            status: 'warning',
            message: `${qty} SF of wall face is unusually small. Verify — did Jamie have real dimensions?`,
          })
        }
      }

      // Labor hour sanity
      if (li.category === 'Labor' && qty > 200) {
        warnings.push({
          line_item_name: li.name,
          work_area: wa.name,
          status: 'warning',
          message: `${qty} labor hours in one work area is extremely high — check for cross-contamination from other areas.`,
        })
      }

      // Equipment hour sanity
      if (li.category === 'Equipment' && qty > 100) {
        warnings.push({
          line_item_name: li.name,
          work_area: wa.name,
          status: 'warning',
          message: `${qty} equipment hours is unusually high — verify.`,
        })
      }
    }
  }

  // ── Cross-area duplicate detection ──
  for (const [itemName, areas] of globalItemMap) {
    if (areas.length > 1 && !itemName.includes('general conditions') && !itemName.includes('rounding')) {
      const uniqueAreas = [...new Set(areas)]
      if (uniqueAreas.length > 1) {
        warnings.push({
          line_item_name: itemName,
          work_area: uniqueAreas.join(', '),
          status: 'warning',
          message: `"${itemName}" appears in ${uniqueAreas.length} work areas (${uniqueAreas.join(', ')}). Check for duplicates.`,
        })
      }
    }
  }

  return {
    overall_status: warnings.length > 0 ? 'warning' : 'ok',
    summary: warnings.length > 0
      ? `${warnings.length} item${warnings.length === 1 ? '' : 's'} need attention before sending to QuickCalc.`
      : 'Estimate looks complete — ready to send to QuickCalc.',
    items: warnings,
  }
}

// ── Work Area Review (Conversational) ──

export async function jamieReviewWorkArea(
  workAreaName: string,
  lineItems: LineItemData[],
  scopeDescription: string | null,
  gapQuestions: string[],
  newCatalogItemNames: string[],
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const itemsSummary = lineItems.map((li) => `${li.name}: ${li.quantity} ${li.unit} (${li.category})`).join('\n')
  const laborItems = lineItems.filter((li) => li.category === 'Labor')
  const totalManHours = laborItems.reduce((sum, li) => sum + li.quantity, 0)

  // Build initial review message if no conversation history
  let initialContext = ''
  if (conversationHistory.length === 0) {
    initialContext = `Generate an initial review message for this work area. Follow this format exactly:

"Here's what I built for ${workAreaName}. Before I lock this in:

[SUMMARY: ${lineItems.length} items, ~${Math.round(totalManHours)} man hours]

A few things to confirm:
${gapQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
${newCatalogItemNames.length > 0 ? `\nI also flagged ${newCatalogItemNames.length} item${newCatalogItemNames.length !== 1 ? 's' : ''} not priced in your catalog yet.` : ''}

Ready to finalize?"

Adjust the summary numbers based on the actual line items provided.`
  }

  const messages = conversationHistory.length > 0
    ? conversationHistory.map((m) => ({
        role: m.role as string,
        content: m.content,
      }))
    : [{ role: 'user', content: initialContext }]

  const { data, error } = await callAI<{ reply: string }>({
    model: 'claude-opus-4-20250514',
    temperature: 0.3,
    system: `${JAMIE_CONVERSATIONAL}

You are reviewing a work area estimate with the contractor. Be direct, trade-savvy, and helpful. If the contractor asks questions, answer them using the line item data. If they want changes, suggest specific adjustments.

Work Area: ${workAreaName}
${scopeDescription ? `Scope: ${scopeDescription}` : ''}
Line Items:
${itemsSummary}

Return ONLY valid JSON: { "reply": "..." }`,
    max_tokens: 1000,
    messages,
  })

  if (error || !data) throw new Error(error ?? 'Jamie could not review the work area')
  return data.reply
}
