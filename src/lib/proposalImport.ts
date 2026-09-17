import type { IngestReconstruction, IngestWorkArea } from './ingest'

export interface SubcontractRule { name: string; markup: number; basis: 'selling' | 'cost' }
export interface RebuildOptions { instructions: string; subcontractScope: string; subcontractor: string; markup: number; basis: 'selling' | 'cost' }
export function subcontractArea(area: IngestWorkArea, rule: SubcontractRule): IngestWorkArea {
  if (!rule.name.trim() || !Number.isFinite(rule.markup) || rule.markup < 0 || rule.markup > 200) throw new Error('Enter a subcontractor and markup between 0 and 200%.')
  const amount = Number(area.stated_total)
  if (!Number.isFinite(amount)) throw new Error('The proposal amount is missing.')
  const cost = rule.basis === 'selling' ? amount / (1 + rule.markup / 100) : amount
  const price = Math.round((rule.basis === 'selling' ? amount : amount * (1 + rule.markup / 100)) * 100) / 100
  return { ...area, stated_total: price, confidence: 'high', general_conditions_amount: 0, line_items: [{ category: 'subcontractor', label: `${rule.name.trim()} — ${area.name}`, qty: 1, unit: 'LS', unit_cost: Math.round(cost * 100) / 100, markup_pct: rule.markup, cost_basis: true, selling_total: price, reasoning: 'Preserved subcontract scope and price; no labor or material reconstruction.', needs_pricing: false }] }
}
export function prepareRebuild(raw: IngestReconstruction, rules: Record<number, SubcontractRule>, selectedOptions: number[]): IngestReconstruction {
  if (selectedOptions.some(i => !raw.work_areas[i] || raw.work_areas[i].kind === 'deduct_option')) throw new Error('Deduct options are kept in notes. Apply the selected substitution in the estimate editor.')
  const work_areas = raw.work_areas.map((area, i) => {
    const next = rules[i] ? subcontractArea(area, rules[i]) : area
    return selectedOptions.includes(i) ? { ...next, kind: 'base' as const } : next
  })
  return { ...raw, work_areas, base_total: Math.round(work_areas.filter(a => a.kind === 'base').reduce((n, a) => n + a.stated_total, 0) * 100) / 100 }
}

export async function extractProposalText(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Use a proposal smaller than 25 MB.')
  const ext = file.name.toLowerCase().split('.').pop()
  let text: string
  if (ext === 'pdf') {
    const { extractPdfText } = await import('./pdfText')
    text = await extractPdfText(file)
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
  } else if (ext === 'doc') {
    throw new Error('For older .doc files, use Word → Save As → .docx or PDF, then upload that copy.')
  } else throw new Error('Choose a PDF or Word (.docx) proposal.')
  if (text.trim().length < 40) throw new Error('This file has too little readable text. For a scanned PDF, save a searchable/OCR copy or paste its text.')
  if (text.length > 120000) throw new Error('This proposal is too long. Upload the scope and pricing pages separately.')
  return text.trim()
}
