// Jamie AI — BidClaw's AI Estimating Agent
// Powered by Anthropic Claude, trained in KYN methodology

import { callAI } from '@/lib/supabase'
import type { WorkAreaData, LineItemData, CatalogItem, ProductionRate } from '@/lib/types'

// ── Jamie System Prompt ──
const JAMIE_SYSTEM = `You are Jamie, the AI estimating agent for BidClaw — a landscape and masonry estimating tool by Blue Claw Group.

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
  productionRates: ProductionRate[]
): Promise<JamieBuildResult> {
  const catalogNames = userCatalog.map((i) => `${i.name} (${i.type})`).join(', ')
  const ratesList = productionRates.map((r) => `${r.task_name}: ${r.hours_per_unit} hrs/${r.unit}, crew of ${r.crew_size}`).join('; ')

  const { data, error } = await callAI<JamieBuildResult>({
    system: `${JAMIE_SYSTEM}

You are building an estimate from a job intake conversation. Generate work areas with line items.

The contractor's Item Catalog: ${catalogNames || 'No items yet'}
The contractor's Production Rates: ${ratesList || 'No rates configured'}

RULES:
- Match item names to the catalog exactly where possible
- Use realistic quantities based on the intake answers
- Include all relevant categories: Materials, Labor, Equipment, Subcontractor, Disposal
- Write a professional scope description for each work area (2-3 sentences, client-facing)
- Output quantities and scope ONLY — no dollar amounts

Return ONLY valid JSON:
{
  "work_areas": [
    { "id": "wa_1", "name": "Area Name", "description": "Scope", "complexity": "Moderate", "approved": false }
  ],
  "line_items": {
    "wa_1": [
      { "id": "li_1", "name": "Item Name", "quantity": 100, "unit": "SF", "category": "Materials", "description": "Scope line" }
    ]
  },
  "scope_descriptions": {
    "wa_1": "Professional multi-line scope description for client proposal."
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

// ── Scope Writer (per work area) ──

export async function jamieWriteScope(
  workAreaName: string,
  lineItems: LineItemData[]
): Promise<string> {
  const itemsSummary = lineItems.map((li) => `${li.name}: ${li.quantity} ${li.unit} (${li.category})`).join('\n')

  const { data, error } = await callAI<{ scope: string }>({
    system: `${JAMIE_SYSTEM}

Write a professional, client-facing scope description for a work area. The tone should be confident, experienced, and clear — like Blue Claw Associates would present to a client. 2-4 sentences covering what will be done, materials used, and the end result.

Return ONLY valid JSON: { "scope": "..." }`,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Work Area: ${workAreaName}\n\nLine Items:\n${itemsSummary}`,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? 'Jamie could not write scope')
  return data.scope
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
    system: `${JAMIE_SYSTEM}

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

      // Warning: missing material cost (what you pay) on material line items
      if (li.category === 'Materials' && (li.unit_cost === null || li.unit_cost === undefined || li.unit_cost <= 0)) {
        warnings.push({
          line_item_name: li.name,
          work_area: wa.name,
          status: 'warning',
          message: `Missing material cost (what you pay) on "${li.name}".`,
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
