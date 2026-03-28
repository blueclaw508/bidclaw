// Plan Processor — Two-path PDF handling for BidClaw
// Path 1: Text-based PDFs → pass as document (Claude text extraction)
// Path 2: Raster/flattened PDFs → convert to JPEG image for Claude vision API
// Non-PDF images (JPG, PNG, WebP, TIFF) → pass directly as images

import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export interface PlanContent {
  type: 'document_url' | 'image_url' | 'image_base64'
  url?: string
  data?: string
  mediaType?: string
}

const TEXT_THRESHOLD = 100 // characters — below this, treat as raster
const RASTER_DPI = 150
const JPEG_QUALITY = 0.75

/**
 * Process a plan file URL and determine the best way to send it to Claude.
 * - Text-based PDFs: pass URL as document (Claude extracts text natively)
 * - Raster PDFs: convert to JPEG base64 for vision API
 * - Images: pass URL directly as image
 */
export async function processPlanFile(
  url: string,
  originalFileName?: string
): Promise<PlanContent> {
  const ext = (originalFileName ?? url).split('.').pop()?.toLowerCase() ?? ''

  console.log(`[PlanProcessor] Processing: ${url}`)
  console.log(`[PlanProcessor] Detected extension: "${ext}"`)

  // Non-PDF images — pass directly as image URL
  if (['png', 'jpg', 'jpeg', 'webp', 'tiff'].includes(ext)) {
    console.log(`[PlanProcessor] → Returning as image_url (non-PDF image)`)
    return { type: 'image_url', url }
  }

  // Not a PDF and not an image — skip
  if (ext !== 'pdf') {
    console.log(`[PlanProcessor] → Unknown extension, returning as document_url`)
    return { type: 'document_url', url }
  }

  // PDF — try text extraction first to determine if raster or vector
  try {
    const textContent = await extractTextFromPDF(url)
    console.log(`[PlanProcessor] PDF text extracted: ${textContent.trim().length} chars (threshold: ${TEXT_THRESHOLD})`)

    if (textContent && textContent.trim().length > TEXT_THRESHOLD) {
      // Text-based PDF — use document URL (Claude handles these well)
      console.log(`[PlanProcessor] → Text-based PDF, returning as document_url`)
      return { type: 'document_url', url }
    }

    // Raster/flattened PDF — convert to JPEG for vision
    console.log(`[PlanProcessor] → Raster PDF (low text), converting to JPEG...`)
    const imageData = await rasterizePDFToBase64(url)
    console.log(`[PlanProcessor] → Rasterized to ${(imageData.length / 1024).toFixed(0)} KB base64`)
    return {
      type: 'image_base64',
      data: imageData,
      mediaType: 'image/jpeg',
    }
  } catch (err) {
    console.warn(`[PlanProcessor] Text extraction failed:`, err)
    // If text extraction fails entirely, try rasterization as fallback
    try {
      console.log(`[PlanProcessor] → Fallback: rasterizing PDF...`)
      const imageData = await rasterizePDFToBase64(url)
      console.log(`[PlanProcessor] → Fallback rasterized to ${(imageData.length / 1024).toFixed(0)} KB base64`)
      return {
        type: 'image_base64',
        data: imageData,
        mediaType: 'image/jpeg',
      }
    } catch (err2) {
      console.error(`[PlanProcessor] Rasterization also failed:`, err2)
      // Last resort — send as document URL and let Claude try
      return { type: 'document_url', url }
    }
  }
}

/**
 * Extract text content from a PDF using pdf.js.
 * Returns concatenated text from all pages.
 */
async function extractTextFromPDF(url: string): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ url, disableAutoFetch: true }).promise
  const textParts: string[] = []

  // Check first 3 pages max (enough to determine if text-based)
  const pagesToCheck = Math.min(pdf.numPages, 3)

  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    textParts.push(pageText)
  }

  pdf.destroy()
  return textParts.join('\n')
}

/**
 * Rasterize a PDF to a JPEG base64 string using canvas rendering.
 * Renders the first page at the specified DPI.
 * For multi-page plans, we take the first page (usually the site plan).
 */
async function rasterizePDFToBase64(url: string): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ url }).promise
  const page = await pdf.getPage(1)

  // Calculate scale for target DPI (PDF default is 72 DPI)
  const scale = RASTER_DPI / 72
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')

  await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise

  // Convert to JPEG base64 (strip data URL prefix)
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')

  pdf.destroy()
  return base64
}
