// Client-side PDF → plain text for reverse ingestion. Uses the pdfjs
// already bundled for the measure tool. hasEOL preserves the line
// structure ("Total <Name> …… $<Amt>" stays one line) that jamie-ingest
// keys off. Word/CoWork docs come in via paste instead (no bundled docx
// reader yet).

import { getDocument } from '@/lib/pdfjs'

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const doc = await getDocument({ data: buf }).promise
  try {
    let out = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item) {
          out += item.str
          out += (item as { hasEOL?: boolean }).hasEOL ? '\n' : ' '
        }
      }
      out += '\n\n'
      page.cleanup()
    }
    return out.trim()
  } finally {
    await doc.destroy()
  }
}
