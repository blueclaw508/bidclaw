import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// Call Netlify serverless function for AI (handles SSE streaming response)
export async function callAI<T = unknown>(payload: {
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
  system?: string
  max_tokens?: number
}): Promise<{ data: T | null; error: string | null }> {
  const MAX_RETRIES = 2

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 120_000) // 2 minute timeout

      const response = await fetch('/.netlify/functions/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        // Retry on 5xx server errors
        if (response.status >= 500 && attempt < MAX_RETRIES) continue
        return { data: null, error: errorText || `HTTP ${response.status}` }
      }

      // Handle SSE streaming response
      const contentType = response.headers.get('content-type') || ''
      let text: string

      if (contentType.includes('text/event-stream')) {
        // Read the SSE stream and accumulate the full text
        text = await readSSEStream(response)
      } else {
        // Fallback: handle non-streaming JSON response (backward compat)
        const raw = await response.json()
        // Guard: edge function may return { error: '...' } directly when JSON parse failed server-side
        if (raw?.error && !raw?.content) {
          return { data: null, error: 'Jamie needs a bit more detail to build work areas. Add a project description or upload a plan and try again.' }
        }
        text = raw?.content?.[0]?.text
        if (!text) return { data: null, error: 'No response from Jamie' }
      }

      // Parse JSON from the response (strip markdown code fences if present)
      try {
        const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
        const parsed = JSON.parse(jsonStr)
        // Guard: if edge function returned an error object instead of expected data, surface it cleanly
        if (parsed && typeof parsed === 'object' && 'error' in parsed && !('work_areas' in parsed) && !('line_items' in parsed) && !('message' in parsed)) {
          return { data: null, error: 'Jamie needs a bit more detail to build work areas. Add a project description or upload a plan and try again.' }
        }
        return { data: parsed as T, error: null }
      } catch {
        // Auto-retry once on unparseable response (Jamie may have returned prose)
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        // Don't expose raw response text — classify for the friendly modal
        return { data: null, error: 'Jamie returned unparseable response' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      // Retry on network/abort errors
      if (attempt < MAX_RETRIES && (msg.includes('abort') || msg.includes('network') || msg.includes('fetch'))) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))) // exponential backoff
        continue
      }
      return { data: null, error: msg }
    }
  }

  return { data: null, error: 'Jamie could not complete the request after retries' }
}

// Read an SSE stream from the ai-chat function and return the full text
async function readSSEStream(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No readable stream')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'chunk') {
          fullText += event.text
        } else if (event.type === 'done') {
          // Server sends final assembled response — use its text
          const finalText = event.response?.content?.[0]?.text
          if (finalText) return finalText
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Stream error')
        }
      } catch (e) {
        if (e instanceof Error && e.message !== 'Stream error') continue // skip parse errors
        throw e
      }
    }
  }

  if (!fullText) throw new Error('Empty response from Jamie')
  return fullText
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
