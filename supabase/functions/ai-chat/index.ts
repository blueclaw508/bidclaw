// @ts-nocheck — Deno edge function
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// BCA Estimator knowledge — derived from SKILL.md
const BCA_CONTEXT = `
ESTIMATING PRINCIPLES (from Know Your Numbers / BCA methodology):

The estimator's jobs are:
1. Measure the work area accurately
2. Specify the right materials and quantities
3. Throw an accurate dart on labor hours

Everything else (margin, overhead recovery, markup) is automatic via My Numbers.

LABOR RULES:
- Standard crew = 3 men
- Half Day: 3 men × 4.5 hrs = 13.5 man hours (minimum billable increment)
- Full Day: 3 men × 9 hrs = 27 man hours
- ALWAYS round up to nearest half or full day increment
- If close to a full day, round UP — workers fill time, full days are easier to schedule

NOTES FORMAT (per work area) — ALL lines must be bullet points:
• Line 1: What is being installed, where, per what spec (plan or site visit)
• Line 2: Overall size/quantity of the work area
• Line 3: Material specified (manufacturer, product, color if known)
• Lines 4+: Step-by-step work sequence, one bullet per step
• Last line: "Disposal Fees Included." (when applicable)

GENERAL CONDITIONS:
- Add to round total to a clean number
- Absorb minor miscellaneous costs not itemized
- Keep proposal looking clean and professional

MATERIAL TAKEOFF RULES:
- Material quantities from the estimate = purchase order quantities
- For pavers: SF + 10% waste factor
- For gravel: (SF × depth in ft) × 1.35 = tons
- For mulch: bed SF × depth ÷ 12 ÷ 27 = CY
- For loam: SF × depth ÷ 12 × 1.35 = tons

VERIFIED BCA PRODUCTION RATES:
- Mulch install: 1.5 MH per CY (verified)
- Spring cleanup: 1.0 MH per HR (verified)

LABOR BENCHMARKS (use as starting points):
- Paver patio (full install incl base): ~1 MH per 10-12 SF
- Natural stone: ~1 MH per 6-8 SF
- Retaining wall (block): ~1 MH per 8-10 SF face
- Fieldstone/veneer wall: ~1 MH per 4-6 SF face
- Loam spread & grade: ~1 MH per 500-800 SF (machine-assisted)
- Sod installation: ~1 MH per 400-500 SF
- Plant install (5 gal): ~0.5 MH per EA
- Plant install (B&B tree): ~2-4 MH per EA
`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { action, payload } = await req.json()

    let systemPrompt: string
    let userContent: string | { type: string; text?: string; source?: unknown }[]

    switch (action) {
      case 'methodology_chat': {
        systemPrompt = `You are BidClaw, an AI estimating assistant for ${payload.company_name || 'a landscape/construction company'}.
You are having a conversation to learn about this company's estimating methodology.
Ask follow-up questions about:
- Types of work they do (hardscape, planting, irrigation, grading, etc.)
- Regional factors (climate, soil, material availability)
- Typical project sizes and complexity
- How they currently estimate (by feel, spreadsheet, per-unit rates, etc.)
- Any special considerations

After 3-4 exchanges, provide a summary of what you learned in a "methodology" field.
Always respond with JSON: { "message": "your response", "methodology": "summary if ready, or null" }`

        const messages = payload.messages || []
        userContent = messages.length > 0
          ? messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')
          : 'Hello, I want to tell you about my company.'
        break
      }

      case 'analyze_plan': {
        systemPrompt = `You are BidClaw, an AI estimating assistant for ${payload.company_name}.
${BCA_CONTEXT}

Company methodology: ${payload.methodology || 'No methodology provided yet.'}
Work types this company handles: ${JSON.stringify(payload.work_types || [])}

You are analyzing a job to propose work areas. Break the job into discrete, independently approvable work areas.

Common examples:
- Hardscape: Demo & Excavation / Base Preparation / Paver Installation / Steps / Edging & Cleanup
- Planting: Lawn Preparation / Sod Installation / Planting Beds / Mulching
- Maintenance: Spring Cleanup / Bed Maintenance / Lawn Program

A work area can be combined if it flows naturally. If the client might want to approve or decline it separately, make it its own work area.

Respond in JSON only:
{
  "work_areas": [{ "name": "", "category": "", "rationale": "" }],
  "assumptions": [],
  "questions": []
}`

        // Build user content — use vision if plan URL available
        if (payload.plan_url) {
          userContent = [
            {
              type: 'text',
              text: payload.job_text || 'Analyze this plan and propose work areas.',
            },
            {
              type: 'image',
              source: {
                type: 'url',
                url: payload.plan_url,
              },
            },
          ]
        } else {
          userContent = payload.job_text || 'No plan or description provided.'
        }
        break
      }

      case 'generate_takeoffs': {
        systemPrompt = `You are BidClaw, an AI estimating assistant for ${payload.company_name}.
${BCA_CONTEXT}

Company methodology: ${payload.methodology || 'N/A'}
Material catalog: ${JSON.stringify(payload.materials_catalog || [])}
Equipment catalog: ${JSON.stringify(payload.equipment_catalog || [])}

Generate material takeoffs for each approved work area.
- Use materials from the catalog when available, with their unit costs
- For materials not in the catalog, use reasonable industry estimates
- Apply correct waste factors (10% for pavers, 5-10% for sod, etc.)
- Material quantities = purchase order quantities
- Include all equipment needed (mini excavator, plate compactor, dump truck, etc.)

Respond in JSON only:
{
  "work_areas": [
    {
      "name": "",
      "materials": [{ "name": "", "quantity": 0, "unit": "", "unit_cost": 0, "rationale": "" }],
      "equipment": [{ "name": "", "hours": 0 }],
      "assumptions": []
    }
  ]
}`

        userContent = `Work areas: ${JSON.stringify(payload.work_areas)}
Job details: ${payload.job_text || 'See plan.'}`
        break
      }

      case 'complete_estimate': {
        const crewMen = payload.crew_full_day_men || 3
        const fullHrs = payload.crew_full_day_hours || 9
        const halfHrs = payload.crew_half_day_hours || 4.5
        const fullDayMH = crewMen * fullHrs
        const halfDayMH = crewMen * halfHrs

        systemPrompt = `You are BidClaw, an AI estimating assistant for ${payload.company_name}.
${BCA_CONTEXT}

Company methodology: ${payload.methodology || 'N/A'}
Company production rates: ${JSON.stringify(payload.production_rates || [])}
Crew configuration: ${crewMen} men
  Full day: ${crewMen} × ${fullHrs} hrs = ${fullDayMH} MH
  Half day: ${crewMen} × ${halfHrs} hrs = ${halfDayMH} MH

CRITICAL LABOR RULES:
1. Calculate man hours from production rates and quantities
2. ALWAYS round up to nearest half day (${halfDayMH} MH) or full day (${fullDayMH} MH) increment
3. If close to a full day, round UP to full day
4. Half day (${halfDayMH} MH) is the minimum billable increment

SCOPE NOTES RULES:
- Every line MUST be a bullet point
- Line 1: what is being installed, where, per what spec
- Line 2: overall size/quantity
- Line 3: material specified
- Lines 4+: step-by-step work sequence
- Last line: "Disposal Fees Included." (when applicable)

GENERAL CONDITIONS:
- Add a general conditions line to round the total to a clean number
- Typically 5-10% of material costs

Respond in JSON only:
{
  "work_areas": [
    {
      "name": "",
      "notes": ["bullet 1", "bullet 2"],
      "materials": [{ "name": "", "quantity": 0, "unit": "", "unit_cost": 0, "rationale": "" }],
      "equipment": [{ "name": "", "hours": 0 }],
      "labor": { "man_hours": 0, "increment": "full", "days": 1 },
      "general_conditions": { "amount": 0 }
    }
  ],
  "man_hour_summary": {
    "total_man_hours": 0,
    "total_days": 0,
    "breakdown": [{ "work_area": "", "man_hours": 0, "days": 0 }]
  }
}`

        userContent = `Approved takeoffs: ${JSON.stringify(payload.takeoffs)}`
        break
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: typeof userContent === 'string' ? userContent : userContent,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Claude API error: ${response.status} — ${errText}`)
    }

    const result = await response.json()
    const text = result.content?.[0]?.text ?? ''

    // Try to parse JSON from the response
    let parsed
    try {
      // Extract JSON from potential markdown code block
      const jsonMatch = text.match(/```json?\s*([\s\S]*?)```/) || [null, text]
      parsed = JSON.parse(jsonMatch[1]?.trim() || text)
    } catch {
      // If we can't parse JSON, return the raw text for methodology chat
      parsed = action === 'methodology_chat'
        ? { message: text, methodology: null }
        : { error: 'Failed to parse AI response', raw: text }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
