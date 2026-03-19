import { callAI } from '@/lib/supabase'
import type { AiPass1Response, AiPass2Response, CatalogItem } from '@/lib/types'

const PASS1_SYSTEM = `You are a landscape and masonry estimating assistant trained in the Know Your Numbers (KYN) methodology.

Based on the project plans and description provided, identify and list the distinct work areas for this project. Each work area is a discrete scope section that will be estimated separately.

For each work area provide:
1. A clear, professional name (e.g. "Front Entry Walkway", "Pool Patio", "Side Yard Grading & Loam")
2. A one-sentence description of the scope
3. A complexity rating: Simple | Moderate | Complex

Return ONLY valid JSON. No preamble, no explanation outside the JSON structure:
{
  "work_areas": [
    {
      "id": "wa_1",
      "name": "Work Area Name",
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

  const system = `You are a landscape and masonry estimating assistant trained in the Know Your Numbers (KYN) methodology.

For each work area provided, generate detailed line items for a contractor's estimate.

IMPORTANT RULES:
- Output quantities and scope ONLY. Do NOT include pricing, unit costs, or dollar amounts.
- Pricing is handled separately by BlueQuickCalc using the contractor's KYN rates.
- Match item names to this contractor's Item Catalog where possible: ${JSON.stringify(catalogNames)}
- Use professional, client-facing language for descriptions.

For each line item include:
- name: item name (match catalog names exactly where possible)
- quantity: numeric quantity
- unit: SF | LF | CY | SY | EA | LS | HR | Day | Allow
- category: Materials | Labor | Equipment | Subcontractor | Disposal
- description: professional scope verbiage suitable for a client proposal (1-2 sentences)

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
          "description": "Supply and install irregular bluestone pavers on compacted gravel base."
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
