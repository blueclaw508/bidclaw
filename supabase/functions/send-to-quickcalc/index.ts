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
    const QUICKCALC_API_URL = Deno.env.get('QUICKCALC_API_URL')
    const QUICKCALC_API_KEY = Deno.env.get('QUICKCALC_API_KEY')

    if (!QUICKCALC_API_URL) {
      throw new Error('QUICKCALC_API_URL not configured. Set this in Supabase function secrets.')
    }

    const { payload } = await req.json()

    if (!payload || !payload.source || payload.source !== 'bidclaw') {
      throw new Error('Invalid payload: must include source "bidclaw"')
    }

    if (!payload.estimate || !payload.estimate.work_areas) {
      throw new Error('Invalid payload: missing estimate data')
    }

    // Forward to QuickCalc API
    const response = await fetch(QUICKCALC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(QUICKCALC_API_KEY ? { 'Authorization': `Bearer ${QUICKCALC_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`QuickCalc API error: ${response.status} — ${errText}`)
    }

    const result = await response.json()

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
