// Supabase Edge Function — BidClaw AI proxy
// Streams Anthropic Claude responses back to the client via SSE.
// No hard timeout — edge functions support long-running streams.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { messages, system, max_tokens = 4096 } = body

    // Pre-process messages: download any URL-sourced files and convert to base64
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        if (!Array.isArray(msg.content)) return msg

        const processedContent = await Promise.all(
          msg.content.map(async (part: any) => {
            if (
              (part.type === 'document' || part.type === 'image') &&
              part.source?.type === 'url' &&
              part.source?.url
            ) {
              try {
                const fileResponse = await fetch(part.source.url)
                if (!fileResponse.ok) {
                  return { type: 'text', text: `[Plan file could not be downloaded from: ${part.source.url}]` }
                }
                const buffer = await fileResponse.arrayBuffer()
                const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
                const contentType = fileResponse.headers.get('content-type')
                const ext = part.source.url.split('.').pop()?.toLowerCase()
                const mediaType = contentType ||
                  (ext === 'pdf' ? 'application/pdf' :
                   ext === 'png' ? 'image/png' :
                   ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                   'application/pdf')

                return {
                  type: part.type,
                  source: { type: 'base64', media_type: mediaType, data: base64 },
                }
              } catch (err: any) {
                return { type: 'text', text: `[Plan file download failed: ${err.message}]` }
              }
            }
            return part
          })
        )
        return { ...msg, content: processedContent }
      })
    )

    // Call Anthropic API with streaming
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        stream: true,
        system: system || '',
        messages: processedMessages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Stream SSE back to client — same format the Netlify function used
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ;(async () => {
      try {
        let fullText = ''
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue

            try {
              const event = JSON.parse(data)
              if (event.type === 'content_block_delta' && event.delta?.text) {
                fullText += event.delta.text
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: event.delta.text })}\n\n`))
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        const finalResponse = {
          content: [{ type: 'text', text: fullText }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done', response: finalResponse })}\n\n`))
      } catch (err: any) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
      } finally {
        await writer.close()
      }
    })()

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
