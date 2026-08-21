// Client transport for the jamie-ingest edge function. Streams the
// reconstruction (SSE, same contract the verify-ingest harness proved),
// reports progress so the UI can reassure during a 1–3 minute Opus call,
// and returns the parsed reconstruction. Auth/gate/metering are all
// server-side — this is a thin pipe.

import { supabase } from '@/lib/supabase'
import type { IngestReconstruction } from '@/lib/ingest'

export async function runIngestion(
  proposalText: string,
  onProgress?: (accumulated: string) => void
): Promise<IngestReconstruction> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in.')

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jamie-ingest`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ proposal_text: proposalText }),
    }
  )

  // Denies / validation errors come back as JSON, not SSE.
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Ingestion failed (HTTP ${res.status}).`)
  }

  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  let done = false
  let err: string | null = null
  for (;;) {
    const { done: d, value } = await reader.read()
    if (d) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '))
      buf = buf.slice(i + 2)
      if (!line) continue
      let ev: { type?: string; delta?: { type?: string; text?: string }; error?: string }
      try {
        ev = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        full += ev.delta.text ?? ''
        onProgress?.(full)
      } else if (ev.type === 'jamie_done') {
        done = true
      } else if (ev.type === 'jamie_error') {
        err = ev.error ?? 'Jamie hit a snag.'
      }
    }
  }
  if (err) throw new Error(err)
  if (!done && !full) throw new Error('The connection dropped before Jamie finished. Try again.')
  try {
    return JSON.parse(full) as IngestReconstruction
  } catch {
    throw new Error('Jamie returned an unreadable result. Try again.')
  }
}

/** Rough live count of work areas seen so far in the streamed JSON —
 *  feeds the "N work areas so far" progress line. */
export function countWorkAreasSoFar(accumulated: string): number {
  return (accumulated.match(/"stated_total"/g) || []).length
}
