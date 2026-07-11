// SSE client for the jamie-chat Edge Function (J2). This is a THIN
// transport: auth/gate/metering all live server-side (J1) — the panel
// reuses the harness-proven contract exactly, no parallel client logic.

import { supabase } from '@/lib/supabase'

export interface JamieChatCallbacks {
  /** Streamed text as it arrives (append to the pending bubble). */
  onTextDelta: (text: string) => void
  /** jamie_done sentinel — the turn finished and metering is finalized. */
  onDone: () => void
  /** Typed deny (403 JSON) or stream failure. */
  onError: (message: string, code?: string) => void
}

/**
 * Send one chat turn. Resolves when the stream closes (after onDone /
 * onError has fired). Contract: POST { jamie_run_id, message, request_type }
 * → SSE pass-through of Anthropic events + jamie_done / jamie_error.
 */
export async function sendJamieChatMessage(
  input: {
    runId: string
    text: string
    imageRefs?: string[]
    requestType?: 'vision_estimate' | 'validation' | 'summary'
    signal?: AbortSignal
  },
  cb: JamieChatCallbacks
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    cb.onError('Not signed in.')
    return
  }

  let res: Response
  try {
    res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jamie-chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jamie_run_id: input.runId,
          message: { text: input.text, image_refs: input.imageRefs ?? [] },
          request_type: input.requestType ?? 'vision_estimate',
        }),
        signal: input.signal,
      }
    )
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : 'Network error.')
    return
  }

  // Denies and validation errors come back as plain JSON, not SSE.
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    try {
      const body = await res.json()
      cb.onError(body.error ?? 'Jamie hit a snag.', body.code)
    } catch {
      cb.onError(`Jamie hit a snag (HTTP ${res.status}).`)
    }
    return
  }

  // Same frame parser the J1 harness proved against the live function.
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finished = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      let event: {
        type?: string
        delta?: { type?: string; text?: string }
        error?: string
      }
      try {
        event = JSON.parse(line.slice(6))
      } catch {
        continue // keepalive / non-JSON frame
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        cb.onTextDelta(event.delta.text ?? '')
      } else if (event.type === 'jamie_done') {
        finished = true
        cb.onDone()
      } else if (event.type === 'jamie_error') {
        finished = true
        cb.onError(event.error ?? 'Jamie hit a snag.')
      }
    }
  }
  if (!finished) {
    cb.onError('The connection dropped mid-reply. Try again.')
  }
}
