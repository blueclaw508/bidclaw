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
    const { messages, system, max_tokens = 4096 } = body

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
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        system: system || '',
        messages: processedMessages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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
