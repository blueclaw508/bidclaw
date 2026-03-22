// Netlify serverless function for Jamie's web search layer
// Fires material assembly searches for each work area before line item generation.
// Uses Claude with the web_search tool to find complete material lists for each work type.

export default async (req) => {
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
    const { work_areas } = await req.json()

    if (!work_areas || !Array.isArray(work_areas) || work_areas.length === 0) {
      return new Response(
        JSON.stringify({ error: 'work_areas array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Fire searches in parallel — one per work area (max 6 to avoid rate limits)
    const searchPromises = work_areas.slice(0, 6).map((wa) =>
      searchMaterialAssembly(ANTHROPIC_API_KEY, wa.name, wa.description)
    )

    const results = await Promise.allSettled(searchPromises)

    // Build results map keyed by work area id
    const searchResults = {}
    for (let i = 0; i < work_areas.length && i < 6; i++) {
      const wa = work_areas[i]
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        searchResults[wa.id] = result.value
      } else {
        searchResults[wa.id] = null
      }
    }

    return new Response(JSON.stringify({ search_results: searchResults }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Web search failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * Search for the complete material assembly for a specific work type.
 * Uses Claude with web_search tool to find real contractor material lists.
 * Returns a concise summary of materials, equipment, and consumables.
 */
async function searchMaterialAssembly(apiKey, workAreaName, workAreaDescription) {
  const query = `${workAreaName} complete materials list contractor estimate`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      tools: [
        {
          type: 'web_search',
          name: 'web_search',
          max_uses: 3,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Search the web for: "${query}"

Work area context: ${workAreaDescription || workAreaName}

Based on your search results, list every material, consumable, and equipment item that a contractor would need for this work type. Focus on items that are easy to forget — adhesives, fasteners, filter fabric, underlayment, sealers, drainage components, edge restraints, waste disposal, etc.

Return a concise bulleted list. No prices. No quantities. Just the complete list of what goes into this job physically. Group by: Materials, Consumables, Equipment.

If you cannot find useful search results, return your best knowledge of the complete assembly.`,
        },
      ],
    }),
  })

  if (!response.ok) {
    console.error(`Web search API error: ${response.status}`)
    return null
  }

  const result = await response.json()

  // Extract text from the response (may have tool use blocks mixed in)
  let assemblyText = ''
  for (const block of result.content || []) {
    if (block.type === 'text') {
      assemblyText += block.text
    }
  }

  return assemblyText.trim() || null
}

export const config = {
  path: '/.netlify/functions/web-search',
}
