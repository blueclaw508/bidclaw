// Jamie — BidClaw's Estimating Agent
// Powered by Anthropic Claude, trained in KYN methodology

import { callAI } from '@/lib/supabase'
import { buildUnifiedEstimatePrompt, crossValidateScopeAndItems } from '@/lib/jamiePrompt'
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

  // Cross-validate scope/line-item alignment
  for (const [waId, scope] of Object.entries(data.scope_descriptions ?? {})) {
    const items = data.line_items[waId]
    if (scope && items) {
      crossValidateScopeAndItems(scope, items)
    }
  }

  return data
}

// ── Unified Scope + Line Items Writer (per work area) ──
// Prime Directive: scope and line items are ALWAYS generated together.

export interface JamieScopeResult {
  scope_description: string
  line_items: LineItemData[]
}

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

  // Cross-validate
  crossValidateScopeAndItems(data.scope_description, data.line_items)

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
  // Pure local analysis — no AI call needed, no pricing checks
  const warnings: JamieAnalysisItem[] = []

  for (const wa of workAreas) {
    const items = lineItems[wa.id] ?? []

    // Warning: work area with no line items
    if (items.length === 0) {
      warnings.push({
        line_item_name: wa.name,
        work_area: wa.name,
        status: 'warning',
        message: 'This work area has no line items.',
      })
      continue
    }

    for (const li of items) {
      // Warning: missing quantity on any line item
      if (!li.quantity || li.quantity <= 0) {
        warnings.push({
          line_item_name: li.name,
          work_area: wa.name,
          status: 'warning',
          message: `Missing quantity on "${li.name}".`,
        })
      }

      // Warning: missing man hours on labor lines
      if (li.category === 'Labor' && (!li.quantity || li.quantity <= 0)) {
        warnings.push({
          line_item_name: li.name,
          work_area: wa.name,
          status: 'warning',
          message: `Missing man hours on labor item "${li.name}".`,
        })
      }

      // Pricing warnings removed — BidClaw handles quantities only
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
