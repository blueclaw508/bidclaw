// Image helpers for the Jamie chat panel (J2). Photos are resized
// CLIENT-SIDE to ≤1568px on the long edge before upload — that bounds
// both Anthropic vision tokens and upload size — then stored in the
// PRIVATE jamie-images bucket under the caller's own folder (owner-folder
// RLS, migration 0023). Messages persist the storage REF, never base64.

import { supabase } from '@/lib/supabase'

/** Long-edge cap. ~1568px is the Anthropic vision sweet spot. */
export const JAMIE_IMAGE_MAX_EDGE = 1568

/**
 * Downscale to ≤maxEdge on the long side and re-encode as JPEG (q=0.85).
 * Images already small enough are still re-encoded so every upload is a
 * predictable .jpg.
 */
export async function resizeImageToJpeg(
  file: File,
  maxEdge = JAMIE_IMAGE_MAX_EDGE
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encode failed.'))),
      'image/jpeg',
      0.85
    )
  })
}

/**
 * Resize + upload one photo for a run. Returns the storage ref
 * (`{userId}/{runId}/{uuid}.jpg`) the Edge Function will fetch.
 */
export async function uploadJamieImage(
  userId: string,
  runId: string,
  file: File
): Promise<string> {
  const blob = await resizeImageToJpeg(file)
  const ref = `${userId}/${runId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from('jamie-images')
    .upload(ref, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(`Photo upload failed: ${error.message}`)
  return ref
}

/** Short-lived signed URL for rendering a private-bucket thumbnail. */
export async function signedJamieImageUrl(ref: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('jamie-images')
    .createSignedUrl(ref, 3600)
  if (error || !data) return null
  return data.signedUrl
}
