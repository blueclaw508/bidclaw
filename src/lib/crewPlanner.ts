import type { ProposalWithWorkAreas, ProposalWorkAreaResolved } from './types'

export type CrewLanguage = 'en' | 'es' | 'both'
export type CrewTranslations = Record<string, string>

export function crewTexts(proposal: ProposalWithWorkAreas, areas: ProposalWorkAreaResolved[]): Record<string, string> {
  const texts: Record<string, string> = {}
  const add = (key: string, value: string | null | undefined) => { if (value?.trim()) texts[key] = value }
  add('title', proposal.name)
  add('notes', proposal.notes)
  for (const area of areas) {
    add(`area:${area.id}`, area.resolved_name)
    add(`scope:${area.id}`, area.resolved_description)
    for (const line of area.lines) add(`line:${line.id}`, line.label)
  }
  return texts
}

export function completeCrewTranslation(source: Record<string,string>, translated: unknown): translated is CrewTranslations {
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) return false
  const result = translated as Record<string,unknown>
  return Object.keys(result).length === Object.keys(source).length && Object.keys(source).every(key => typeof result[key] === 'string' && (result[key] as string).trim())
}
