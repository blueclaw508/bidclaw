// Netlify serverless function for BidClaw AI calls
// Calls Anthropic Claude API on behalf of the frontend
// Handles downloading plan files and converting to base64 for the API

export default async (req) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { messages, system, max_tokens = 4096, model = 'claude-sonnet-4-20250514', temperature, tools } = body

    // Pre-process messages: download any URL-sourced files and convert to base64
    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        if (!Array.isArray(msg.content)) return msg

        const processedContent = await Promise.all(
          msg.content.map(async (part) => {
            // Handle document or image with URL source — download and convert to base64
            if (
              (part.type === 'document' || part.type === 'image') &&
              part.source?.type === 'url' &&
              part.source?.url
            ) {
              try {
                const fileResponse = await fetch(part.source.url)
                if (!fileResponse.ok) {
                  // Fall back to text description if download fails
                  return {
                    type: 'text',
                    text: `[Plan file could not be downloaded from: ${part.source.url}]`,
                  }
                }

                const buffer = await fileResponse.arrayBuffer()
                const base64 = Buffer.from(buffer).toString('base64')

                // Determine media type from URL or response headers
                const contentType = fileResponse.headers.get('content-type')
                const ext = part.source.url.split('.').pop()?.toLowerCase()
                const mediaType = contentType ||
                  (ext === 'pdf' ? 'application/pdf' :
                   ext === 'png' ? 'image/png' :
                   ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                   'application/pdf')

                return {
                  type: part.type,
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64,
                  },
                }
              } catch (err) {
                return {
                  type: 'text',
                  text: `[Plan file download failed: ${err.message}]`,
                }
              }
            }
            return part
          })
        )

        return { ...msg, content: processedContent }
      })
    )

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        stream: true,
        system: system || '',
        messages: processedMessages,
        ...(temperature !== undefined && { temperature }),
        ...(tools && tools.length > 0 && { tools }),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Stream the response back to the client using SSE format
    // This keeps the connection alive and prevents timeouts
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    // Process the Anthropic SSE stream in the background
    ;(async () => {
      try {
        let fullText = ''
        const reader = response.body.getReader()
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
                // Send keepalive chunk to prevent client timeout
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: event.delta.text })}\n\n`))
              } else if (event.type === 'content_block_start' || event.type === 'content_block_stop' || event.type === 'message_delta') {
                // Send keepalive during web search tool use to prevent client timeout
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: '' })}\n\n`))
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        // Send the final assembled response in the format the client expects
        const finalResponse = {
          content: [{ type: 'text', text: fullText }],
          model,
          stop_reason: 'end_turn',
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done', response: finalResponse })}\n\n`))
      } catch (err) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
      } finally {
        await writer.close()
      }
    })()

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const config = {
  path: '/.netlify/functions/ai-chat',
}
