// @ts-nocheck — Deno edge function
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
Here is everything you know about this company's estimating methodology:
${payload.methodology || 'No methodology provided yet.'}
Work types this company handles: ${JSON.stringify(payload.work_types || [])}

You are analyzing a job to propose work areas. Respond in JSON only:
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
Company methodology: ${payload.methodology || 'N/A'}
Material catalog: ${JSON.stringify(payload.materials_catalog || [])}
Equipment catalog: ${JSON.stringify(payload.equipment_catalog || [])}

Generate material takeoffs for each approved work area. Use materials from the catalog when available, with their unit costs. For materials not in the catalog, use reasonable industry estimates.

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
        const fullDayMH = (payload.crew_full_day_men || 3) * (payload.crew_full_day_hours || 9)
        const halfDayMH = (payload.crew_full_day_men || 3) * (payload.crew_half_day_hours || 4.5)

        systemPrompt = `You are BidClaw, an AI estimating assistant for ${payload.company_name}.
Company methodology: ${payload.methodology || 'N/A'}
Production rates: ${JSON.stringify(payload.production_rates || [])}
Crew: full day = ${payload.crew_full_day_men || 3} men x ${payload.crew_full_day_hours || 9} hrs = ${fullDayMH} MH, half day = ${payload.crew_full_day_men || 3} men x ${payload.crew_half_day_hours || 4.5} hrs = ${halfDayMH} MH

Complete the full estimate:
1. Calculate labor hours from production rates and quantities
2. Round labor up to nearest half or full day increment
3. Write scope notes in bullet format:
   - First bullet: what is being installed, where, per what spec
   - Second bullet: overall size/quantity
   - Third bullet: material specified
   - Remaining bullets: step by step work sequence
   - Last bullet: Disposal Fees Included (if applicable)
4. Add general conditions (typically 5-10% of material costs)

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
