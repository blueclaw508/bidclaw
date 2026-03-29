// Plan Processor — ALWAYS rasterize PDFs to images for Jamie's vision
// Landscape plans are DRAWINGS. Jamie needs to SEE them, not just read text.
// Text annotations are extracted separately as supplementary context.

import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export interface PlanContent {
  type: 'image_base64' | 'image_url'
  /** Base64 image data (for rasterized PDFs) */
  data?: string
  /** Direct URL (for non-PDF images) */
  url?: string
  mediaType?: string
  /** Extracted text annotations from the plan (supplementary context) */
  extractedText?: string
}

const RASTER_DPI = 200 // Higher DPI for landscape plans — need to read dimensions
const JPEG_QUALITY = 0.85

/**
 * Process a plan file URL for Jamie's vision API.
 * PDFs are ALWAYS rasterized to images — landscape plans are visual drawings.
 * Text annotations are extracted separately and returned alongside the image.
 * Non-PDF images are passed through directly.
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
    console.log(`[PlanProcessor] → Image file, returning as image_url`)
    return { type: 'image_url', url }
  }

  // Not a PDF and not an image — try as image URL anyway
  if (ext !== 'pdf') {
    console.log(`[PlanProcessor] → Unknown extension "${ext}", trying as image_url`)
    return { type: 'image_url', url }
  }

  // PDF — ALWAYS rasterize to image. Also extract text annotations.
  console.log(`[PlanProcessor] → PDF detected. Rasterizing to image...`)

  let extractedText = ''
  let imageData = ''

  // Step 1: Try to extract text annotations (non-blocking — failure is OK)
  try {
    extractedText = await extractTextFromPDF(url)
    console.log(`[PlanProcessor] → Extracted ${extractedText.trim().length} chars of text annotations`)
  } catch (err) {
    console.warn(`[PlanProcessor] → Text extraction failed (non-fatal):`, err)
  }

  // Step 2: Rasterize the PDF to a JPEG image (THIS IS THE CRITICAL PATH)
  try {
    imageData = await rasterizePDFToBase64(url)
    console.log(`[PlanProcessor] → Rasterized to ${(imageData.length / 1024).toFixed(0)} KB base64`)
    return {
      type: 'image_base64',
      data: imageData,
      mediaType: 'image/jpeg',
      extractedText: extractedText.trim() || undefined,
    }
  } catch (err) {
    console.error(`[PlanProcessor] → Rasterization failed:`, err)
  }

  // Step 3: Fallback — try fetching PDF as raw bytes and rasterize from ArrayBuffer
  try {
    console.log(`[PlanProcessor] → Trying fetch + ArrayBuffer fallback...`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    console.log(`[PlanProcessor] → Fetched ${(arrayBuffer.byteLength / 1024).toFixed(0)} KB PDF`)

    imageData = await rasterizePDFFromBuffer(arrayBuffer)
    console.log(`[PlanProcessor] → Buffer-rasterized to ${(imageData.length / 1024).toFixed(0)} KB base64`)
    return {
      type: 'image_base64',
      data: imageData,
      mediaType: 'image/jpeg',
      extractedText: extractedText.trim() || undefined,
    }
  } catch (err2) {
    console.error(`[PlanProcessor] → ArrayBuffer fallback also failed:`, err2)
  }

  // Step 4: Last resort — try to extract text from buffer even without image
  if (!extractedText) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const buf = await response.arrayBuffer()
        extractedText = await extractTextFromBuffer(buf)
        console.log(`[PlanProcessor] → Last-resort text extraction: ${extractedText.trim().length} chars`)
      }
    } catch {
      // Give up
    }
  }

  // If we have text but no image, return a minimal result
  console.error(`[PlanProcessor] ❌ Could not rasterize plan. Jamie will work from text only.`)
  return {
    type: 'image_base64',
    data: '', // Empty — will be filtered out upstream
    mediaType: 'image/jpeg',
    extractedText: extractedText.trim() || 'Plan PDF could not be processed.',
  }
}

/**
 * Extract text content from a PDF URL using pdf.js.
 */
async function extractTextFromPDF(url: string): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ url, disableAutoFetch: true }).promise
  const text = await extractTextFromDoc(pdf)
  pdf.destroy()
  return text
}

/**
 * Extract text from an ArrayBuffer PDF.
 */
async function extractTextFromBuffer(data: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const text = await extractTextFromDoc(pdf)
  pdf.destroy()
  return text
}

/**
 * Shared text extraction from a pdf.js document.
 */
async function extractTextFromDoc(pdf: pdfjsLib.PDFDocumentProxy): Promise<string> {
  const textParts: string[] = []
  const pagesToCheck = Math.min(pdf.numPages, 5) // Check up to 5 pages for plans

  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    textParts.push(pageText)
  }

  return textParts.join('\n')
}

/**
 * Rasterize a PDF from URL to JPEG base64 using canvas.
 */
async function rasterizePDFToBase64(url: string): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ url }).promise
  const base64 = await rasterizeFirstPage(pdf)
  pdf.destroy()
  return base64
}

/**
 * Rasterize a PDF from ArrayBuffer to JPEG base64 using canvas.
 */
async function rasterizePDFFromBuffer(data: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const base64 = await rasterizeFirstPage(pdf)
  pdf.destroy()
  return base64
}

/**
 * Shared rasterization — renders first page to canvas at target DPI.
 */
async function rasterizeFirstPage(pdf: pdfjsLib.PDFDocumentProxy): Promise<string> {
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
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '')
}
