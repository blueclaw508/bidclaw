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

WORK AREA NAMING RULES:
- Every work area name must include a location descriptor unless obviously unique (e.g. "Driveway")
- Use compass directions when known: "Fieldstone Wall — North Perimeter"
- Use relational descriptors otherwise: "Bluestone Patio at Rear of Residence"
- If plan labels areas by name, use plan terminology
- Differentiate similar items: never "Stone Wall" x5 — always include location

RULES:
- Match item names to the catalog exactly where possible
- Use realistic quantities based on the intake answers
- Include all relevant categories: Materials, Labor, Equipment, Subcontractor, Disposal
- Output quantities and scope ONLY — no dollar amounts

SCOPE DESCRIPTIONS — use this exact bullet format (• character, not *):
• [Line 1] One sentence: what is being installed, where, per what spec.
• [Line 2] Overall size or quantity.
• [Line 3] Material specified if known.
• [Lines 4+] Step-by-step crew instructions, one bullet per step.
• [Last line] "Disposal Fees Included." only if demolition/removal is in scope.
The location in the work area name and Line 1 must match.

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

// ── Scope Writer (per work area) ──

const NOTES_FORMAT_PROMPT = `Write scope notes for a work area using this EXACT bullet format. These notes serve as both the client proposal AND the crew field directive.

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

SPEC SOURCE LANGUAGE for Line 1:
- If plan was uploaded → "per [Plan Name] prepared by [Designer] dated [Date]"
- If no plan → "per site visit"
- If dimensions were manually entered → "per site measurements"`

export async function jamieWriteScope(
  workAreaName: string,
  lineItems: LineItemData[],
  projectDescription?: string,
  planUploaded?: boolean
): Promise<string> {
  const itemsSummary = lineItems.map((li) => `${li.name}: ${li.quantity} ${li.unit} (${li.category})`).join('\n')

  const { data, error } = await callAI<{ scope: string }>({
    system: `${JAMIE_SYSTEM}

${NOTES_FORMAT_PROMPT}

Return ONLY valid JSON: { "scope": "• Line 1\\n• Line 2\\n..." }`,
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `Work Area: ${workAreaName}\n\nLine Items:\n${itemsSummary}${projectDescription ? `\n\nProject Description: ${projectDescription}` : ''}${planUploaded ? '\n\nNote: Plans were uploaded for this project.' : ''}`,
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
