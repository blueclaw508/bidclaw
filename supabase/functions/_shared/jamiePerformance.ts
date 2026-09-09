/** Bounded I/O concurrency; preserve input order for stable document/cache prefixes. */
export async function orderedConcurrentMap<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency must be a positive integer')
  const result: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const index = next++
      result[index] = await task(items[index], index)
    }
  }))
  return result
}

export function cachedSystemPrompt(text: string) {
  return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }]
}
