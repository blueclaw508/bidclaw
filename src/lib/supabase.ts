import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// Call Netlify serverless function for AI
export async function callAI<T = unknown>(payload: {
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
  system?: string
  max_tokens?: number
}): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch('/.netlify/functions/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { data: null, error: errorText || `HTTP ${response.status}` }
    }

    const raw = await response.json()
    // Anthropic returns { content: [{ type: 'text', text: '...' }] }
    const text = raw?.content?.[0]?.text
    if (!text) return { data: null, error: 'No response from AI' }

    // Try to parse JSON from the response (strip markdown code fences if present)
    try {
      const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
      const parsed = JSON.parse(jsonStr) as T
      return { data: parsed, error: null }
    } catch {
      // If it's not JSON, return as error so callers don't get a string where they expect an object
      return { data: null, error: `AI returned unparseable response: ${text.slice(0, 200)}` }
    }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// Legacy edge function caller (for send-to-quickcalc etc.)
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  payload: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token

    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return { data: null, error: errorText || `HTTP ${response.status}` }
    }

    const data = await response.json()
    return { data: data as T, error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
