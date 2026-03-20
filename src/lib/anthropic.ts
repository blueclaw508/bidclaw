import { callAI } from '@/lib/supabase'
import type { AiPass1Response, AiPass2Response, CatalogItem } from '@/lib/types'

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

Return ONLY valid JSON. No preamble, no explanation outside the JSON structure:
{
  "work_areas": [
    {
      "id": "wa_1",
      "name": "Work Area Name with Location",
      "description": "Brief scope description",
      "complexity": "Moderate"
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

  // Add plan files as documents/images
  for (const url of planFileUrls) {
    const ext = url.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') {
      content.push({
        type: 'document',
        source: { type: 'url', url },
      })
    } else if (['png', 'jpg', 'jpeg'].includes(ext ?? '')) {
      content.push({
        type: 'image',
        source: { type: 'url', url },
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

  if (error || !data) throw new Error(error ?? 'No response from AI')
  return data
}

export async function runPass2(
  approvedWorkAreas: { id: string; name: string; description: string }[],
  projectDescription: string,
  userCatalog: CatalogItem[]
): Promise<AiPass2Response> {
  const catalogNames = userCatalog.map((i) => i.name)

  const system = `You are Jamie, a landscape and masonry estimating assistant trained in the Know Your Numbers (KYN) methodology by Blue Claw Group.

For each work area provided, generate detailed line items for a contractor's estimate.

IMPORTANT RULES:
- Output quantities and scope ONLY. Do NOT include pricing, unit costs, or dollar amounts.
- Pricing is handled separately by BlueQuickCalc using the contractor's KYN rates.
- Match item names to this contractor's Item Catalog where possible: ${JSON.stringify(catalogNames)}
- Use professional, trade-savvy language — no salesy wording.
- Written in third person imperative ("Install..." not "We will install...")

For each line item include:
- name: item name (match catalog names exactly where possible)
- quantity: numeric quantity
- unit: SF | LF | CY | SY | EA | LS | HR | Day | Allow
- category: Materials | Labor | Equipment | Subcontractor | Disposal
- description: one precise sentence describing this line item's scope (crew-directive style)

Return ONLY valid JSON:
{
  "work_areas": [
    {
      "id": "wa_1",
      "name": "Front Entry Walkway",
      "line_items": [
        {
          "id": "li_1",
          "name": "Bluestone Irregular",
          "quantity": 120,
          "unit": "SF",
          "category": "Materials",
          "description": "Supply irregular bluestone pavers for walkway installation."
        }
      ]
    }
  ]
}`

  const { data, error } = await callAI<AiPass2Response>({
    system,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Work areas to estimate:\n${JSON.stringify(approvedWorkAreas)}\n\nProject context: ${projectDescription}`,
      },
    ],
  })

  if (error || !data) throw new Error(error ?? 'No response from AI')
  return data
}
