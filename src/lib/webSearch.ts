// Web Search Layer — Layer 1 of Jamie's Three-Layer Brain
// Fires material assembly searches before line item generation.
// Each work area gets a search for its complete material list.
// Results are injected into the Pass2 system prompt so Jamie doesn't miss components.

export interface WebSearchResult {
  [workAreaId: string]: string | null  // assembly text or null if search failed
}

/**
 * Search for complete material assemblies for a list of work areas.
 * Calls the web-search Netlify function which uses Claude + web_search tool.
 * Returns a map of work area ID → material assembly text.
 *
 * Fails gracefully — if the search fails, returns empty results
 * and Jamie falls back to kit library + training knowledge.
 */
export async function searchMaterialAssemblies(
  workAreas: { id: string; name: string; description: string }[]
): Promise<WebSearchResult> {
  if (workAreas.length === 0) return {}

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000) // 30s timeout for search

    const response = await fetch('/.netlify/functions/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_areas: workAreas }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      console.warn('[Web Search] Function returned error:', response.status)
      return {}
    }

    const data = await response.json()
    return data.search_results ?? {}
  } catch (err) {
    // Fail gracefully — web search is additive, not required
    console.warn('[Web Search] Failed, falling back to kit library:', err instanceof Error ? err.message : err)
    return {}
  }
}

/**
 * Format web search results into a prompt block for injection into Jamie's system prompt.
 * Returns empty string if no results (Jamie proceeds with kit library only).
 */
export function formatSearchResultsForPrompt(
  results: WebSearchResult,
  workAreas: { id: string; name: string }[]
): string {
  const blocks: string[] = []

  for (const wa of workAreas) {
    const assemblyText = results[wa.id]
    if (assemblyText) {
      blocks.push(`--- ${wa.name} ---\n${assemblyText}`)
    }
  }

  if (blocks.length === 0) return ''

  return `WEB SEARCH RESULTS — COMPLETE MATERIAL ASSEMBLIES (use these to verify you haven't missed any components):

${blocks.join('\n\n')}

Cross-reference these assemblies against your kit library rates. If a material or consumable appears in the search results but not in your line items, ADD IT. The search results are here to catch items you might otherwise miss — weep screed, filter fabric, geogrid, muriatic acid, sealers, etc.`
}
