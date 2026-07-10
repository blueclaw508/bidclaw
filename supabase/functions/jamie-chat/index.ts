// jamie-chat — THE JAMIE LOOP conversational backbone (J1 skeleton).
//
// The brain is a STUB (system prompt says "reply ECHO: <message>") — J1
// ships the plumbing: auth → founder gate → run ownership → session-limit
// gate → invocation metering → Anthropic streaming → SSE pass-through →
// token/cost finalize → message persistence. The prompt grows at J3/J5/J8.
//
// Distinct from the live Phase-1 `jamie-estimate` function (single-shot,
// work-area level) — that stays untouched and retires at J6.
//
// Order of checks (cheapest deny first, ZERO spend and ZERO writes on any
// deny — the spec's "no invocation row for denied calls"):
//   1. JWT → user
//   2. Founder fast gate (user-level; needs no DB reads)
//   3. Run load + ownership (404 either way — don't leak run existence)
//   4. Full gate vs tier limits + live usage counts
//   5. Meter (invocation row, in_progress) → Anthropic → finalize

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  evaluateFounderModeGate,
  FOUNDER_USER_ID,
  type JamieUsage,
  type TierLimits,
} from './jamieGate.ts'

// ── Model router (Loop Rule 9: Opus for estimation reasoning, Sonnet for
// validation/formatting/summaries; never silently downgrade an Opus task).
// Strings verified 2026-07-10. RE-VERIFY against current Anthropic docs at
// J8 before the knowledge layer ships.
const MODEL_ROUTER: Record<string, string> = {
  vision_estimate: 'claude-opus-4-8',
  validation: 'claude-sonnet-5',
  summary: 'claude-sonnet-5',
}

// $/1M tokens. Verified 2026-07-10 vs Anthropic pricing: Opus 4.8 $5 in /
// $25 out; Sonnet 5 LIST $3 in / $15 out (intro $2/$10 runs through
// 2026-08-31 — we book LIST so cost data never underestimates). Cache
// reads bill 0.1× input; cache writes 1.25× input.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
}

// J1 stub brain. The cache_control STRUCTURE is what ships now — this
// stub is far below the ~1024-token cache minimum, so cached_input_tokens
// stays 0 until the real KYN prompt lands (J3/J5/J8; J8 verifies the hit).
const SYSTEM_STUB =
  "You are Jamie, BidClaw's estimating agent. THIS IS A PLUMBING TEST " +
  "(phase J1). Reply with exactly: ECHO: <the user's message text " +
  'verbatim>. Nothing else — no preamble, no commentary.'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function estimateCostUsd(
  model: string,
  usage: {
    input_tokens?: number | null
    output_tokens?: number | null
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
): number | null {
  const p = MODEL_PRICING[model]
  if (!p) return null
  const usd =
    ((usage.input_tokens ?? 0) * p.input +
      (usage.cache_creation_input_tokens ?? 0) * 1.25 * p.input +
      (usage.cache_read_input_tokens ?? 0) * 0.1 * p.input +
      (usage.output_tokens ?? 0) * p.output) /
    1_000_000
  return Math.round(usd * 10_000) / 10_000
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Live usage counts vs the J0 partial indexes — mirrors jamieLoop.ts. */
async function loadUsage(
  // deno-lint-ignore no-explicit-any
  service: any,
  userId: string,
  run: { image_count: number; chat_turn_count: number },
  newImageCount: number
): Promise<JamieUsage> {
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const quotaMonth = monthStart.toISOString().slice(0, 10)
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  const [quotaRows, totalCount, hourCount] = await Promise.all([
    service
      .from('jamie_invocations')
      .select('jamie_run_id')
      .eq('user_id', userId)
      .eq('counts_against_quota', true)
      .eq('quota_month', quotaMonth),
    service
      .from('jamie_invocations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('quota_month', quotaMonth),
    service
      .from('jamie_invocations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('started_at', hourAgo),
  ])

  return {
    jamieEstimatesThisMonth: new Set(
      (quotaRows.data ?? []).map((r: { jamie_run_id: string }) => r.jamie_run_id)
    ).size,
    invocationsThisMonth: totalCount.count ?? 0,
    invocationsLastHour: hourCount.count ?? 0,
    // Include the images arriving on THIS request so the gate catches the
    // increment, not just the running total.
    imagesThisSession: run.image_count + newImageCount,
    turnsThisSession: run.chat_turn_count,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1 — Auth.
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Not signed in.' }, 401)

  // 2 — Founder fast gate (Loop Rule 8). No DB reads, no writes, no spend.
  if (user.id !== FOUNDER_USER_ID) {
    const denied = evaluateFounderModeGate(user.id, null, {
      jamieEstimatesThisMonth: 0,
      invocationsThisMonth: 0,
      invocationsLastHour: 0,
      imagesThisSession: 0,
      turnsThisSession: 0,
    })
    return json({ error: denied.reason, code: denied.code }, 403)
  }

  let body: {
    jamie_run_id?: string
    message?: { text?: string; image_refs?: string[] }
    request_type?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const runId = body.jamie_run_id
  const text = (body.message?.text ?? '').trim()
  const imageRefs = body.message?.image_refs ?? []
  if (!runId) return json({ error: 'jamie_run_id is required.' }, 400)
  if (!text) return json({ error: 'Say something so Jamie has something to work with.' }, 400)
  if (imageRefs.length > 20) return json({ error: 'Too many images in one message.' }, 400)
  // Ownership on every ref — the function reads storage with service role,
  // so path validation is the isolation boundary.
  if (imageRefs.some((r) => typeof r !== 'string' || !r.startsWith(`${user.id}/`))) {
    return json({ error: 'Invalid image reference.' }, 400)
  }
  const model = MODEL_ROUTER[body.request_type ?? 'vision_estimate']
  if (!model) return json({ error: 'Unknown request_type.' }, 400)

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 3 — Run load + ownership. 404 either way: don't leak existence.
  const { data: run } = await service
    .from('jamie_loop_runs')
    .select('id, user_id, status, image_count, chat_turn_count')
    .eq('id', runId)
    .maybeSingle()
  if (!run || run.user_id !== user.id) {
    return json({ error: 'Jamie session not found.' }, 404)
  }
  if (run.status === 'committed' || run.status === 'rejected') {
    return json({ error: 'This Jamie session is finished. Start a new one.' }, 409)
  }

  // 4 — Full gate (founder tier is all-NULL, but the evaluation ALWAYS
  // runs so the code path is identical when tier-mode replaces founder-mode).
  const { data: limits } = await service
    .from('subscription_tier_limits')
    .select('*')
    .eq('tier', 'founder')
    .maybeSingle()
  const usage = await loadUsage(service, user.id, run, imageRefs.length)
  const gate = evaluateFounderModeGate(user.id, limits as TierLimits | null, usage)
  if (!gate.allowed) return json({ error: gate.reason, code: gate.code }, 403)

  // 5 — Counters + user-message persistence + metering.
  await service
    .from('jamie_loop_runs')
    .update({
      image_count: run.image_count + imageRefs.length,
      chat_turn_count: run.chat_turn_count + 1,
    })
    .eq('id', run.id)
  await service.from('jamie_messages').insert({
    jamie_run_id: run.id,
    role: 'user',
    content: { text, image_refs: imageRefs },
  })
  const { data: invRow, error: invErr } = await service
    .from('jamie_invocations')
    .insert({
      user_id: user.id,
      jamie_run_id: run.id,
      model_used: model,
      image_count: imageRefs.length,
      chat_turn_number: run.chat_turn_count + 1,
    })
    .select('id')
    .single()
  if (invErr || !invRow) return json({ error: 'Metering failed — call not started.' }, 500)
  const invocationId = invRow.id as string

  // Fetch image refs from the private bucket → base64 blocks.
  const content: Anthropic.ContentBlockParam[] = []
  for (const ref of imageRefs) {
    const { data: blob, error: dlErr } = await service.storage
      .from('jamie-images')
      .download(ref)
    if (dlErr || !blob) {
      await service
        .from('jamie_invocations')
        .update({ ended_at: new Date().toISOString(), outcome: 'error' })
        .eq('id', invocationId)
      return json({ error: `Couldn't read an attached photo (${ref.split('/').pop()}).` }, 400)
    }
    const ext = (ref.split('.').pop() ?? '').toLowerCase()
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: (MEDIA_TYPES[ext] ?? 'image/jpeg') as never,
        data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
      },
    })
  }
  content.push({ type: 'text', text })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'Jamie is not configured (missing API key).' }, 500)
  const anthropic = new Anthropic({ apiKey })

  // 6 — Stream: SSE pass-through of Anthropic events, then a jamie_done
  // sentinel. Finalize (tokens + cost) and assistant-message persistence
  // happen inside the stream so nothing races the response lifecycle.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        const msgStream = anthropic.messages.stream({
          model,
          max_tokens: 1024, // stub-sized; grows with the real brain at J3
          thinking: { type: 'adaptive' },
          system: [
            {
              type: 'text',
              text: SYSTEM_STUB,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content }],
        })
        let assistantText = ''
        for await (const event of msgStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            assistantText += event.delta.text
          }
          send(event)
        }
        const final = await msgStream.finalMessage()
        const u = final.usage
        await service.from('jamie_messages').insert({
          jamie_run_id: run.id,
          role: 'assistant',
          content: { text: assistantText },
        })
        await service
          .from('jamie_invocations')
          .update({
            ended_at: new Date().toISOString(),
            // input_tokens folds in cache WRITES; cached_input_tokens = reads.
            input_tokens:
              (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            output_tokens: u.output_tokens ?? 0,
            cached_input_tokens: u.cache_read_input_tokens ?? 0,
            estimated_cost_usd: estimateCostUsd(model, u),
            // outcome stays in_progress — it resolves with the RUN at
            // Gate 2 (J6: committed/rejected) or cleanup (J7: abandoned).
          })
          .eq('id', invocationId)
        send({ type: 'jamie_done' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Jamie hit a snag.'
        await service
          .from('jamie_invocations')
          .update({ ended_at: new Date().toISOString(), outcome: 'error' })
          .eq('id', invocationId)
        send({ type: 'jamie_error', error: `Jamie hit a snag — ${msg}. Try again.` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})
