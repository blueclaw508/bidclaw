// Jamie Chat panel (J2) — the conversational container for THE JAMIE
// LOOP. Right-side panel ≥640px, full-screen sheet below. Jamie still
// ECHOes (J1 stub brain) — this phase is the container: streaming render,
// image attach (client-resized ≤1568px → private bucket), session
// resume, run-status chip. The brain arrives at J3.
//
// Project-anchored (J0 decision): one active run per project, resumed via
// getActiveJamieRun. Distinct from the legacy per-work-area "Ask Jamie"
// button (single-shot modal, retires at J6).

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, Loader2, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createJamieRun,
  getActiveJamieRun,
  listJamieMessages,
  getMyTierLimits,
  type JamieLoopRun,
  type JamieRunStatus,
} from '@/lib/jamieLoop'
import { sendJamieChatMessage } from '@/lib/jamieChat'
import { signedJamieImageUrl, uploadJamieImage } from '@/lib/jamieImages'
import { cn } from '@/lib/utils'

interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  imageRefs: string[]
  /** True while this assistant bubble is still streaming. */
  streaming?: boolean
}

const STATUS_CHIP: Record<
  JamieRunStatus,
  { label: string; className: string; icon?: typeof CircleCheck }
> = {
  in_progress:            { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  awaiting_wa_approval:   { label: 'Awaiting your review', className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  awaiting_line_approval: { label: 'Awaiting your review', className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  committed:              { label: 'Committed',            className: 'bg-emerald-100 text-emerald-800 ring-emerald-200', icon: CircleCheck },
  rejected:               { label: 'Rejected',             className: 'bg-rose-100 text-rose-800 ring-rose-200', icon: CircleX },
  abandoned:              { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  error:                  { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
}

export function JamieChatPanel({
  projectId,
  userId,
  onClose,
}: {
  projectId: string
  userId: string
  onClose: () => void
}) {
  const [run, setRun] = useState<JamieLoopRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [streaming, setStreaming] = useState(false)
  const [imageLimit, setImageLimit] = useState<number | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const threadRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Resume: latest non-terminal run + its messages ─────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [active, limits] = await Promise.all([
          getActiveJamieRun(projectId),
          getMyTierLimits(userId),
        ])
        if (cancelled) return
        setImageLimit(limits?.images_per_jamie_session ?? null)
        if (active) {
          setRun(active)
          const rows = await listJamieMessages(active.id)
          if (cancelled) return
          setMessages(
            rows.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.content.text ?? '',
              imageRefs: m.content.image_refs ?? [],
            }))
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Jamie session failed to load.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, userId])

  // Signed URLs for any refs we haven't resolved yet (private bucket).
  useEffect(() => {
    const missing = messages
      .flatMap((m) => m.imageRefs)
      .filter((r) => !(r in signedUrls))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        missing.map(async (ref) => [ref, await signedJamieImageUrl(ref)] as const)
      )
      if (cancelled) return
      setSignedUrls((prev) => {
        const next = { ...prev }
        for (const [ref, url] of entries) if (url) next[ref] = url
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [messages, signedUrls])

  // Keep the newest message in view while streaming.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  const imagesUsed = (run?.image_count ?? 0) + pendingFiles.length

  const handleSend = useCallback(async () => {
    const text = input.trim()
    // `loading` guard: sending before the resume check resolves would
    // fork a SECOND run while the panel shows the first one's history
    // (caught by the J2 harness — Playwright outraced the resume query).
    if (!text || streaming || loading) return
    setStreaming(true)
    try {
      // Lazy-create the run on first send — an opened-then-closed panel
      // shouldn't leave empty runs behind. Re-check for an active run
      // right before creating (belt-and-braces against the same race).
      let activeRun = run
      if (!activeRun) {
        activeRun = (await getActiveJamieRun(projectId)) ?? (await createJamieRun(projectId))
        setRun(activeRun)
      }
      const refs: string[] = []
      for (const file of pendingFiles) {
        refs.push(await uploadJamieImage(userId, activeRun.id, file))
      }
      setPendingFiles([])
      setInput('')
      const userMsgId = crypto.randomUUID()
      const asstMsgId = crypto.randomUUID()
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: 'user', text, imageRefs: refs },
        { id: asstMsgId, role: 'assistant', text: '', imageRefs: [], streaming: true },
      ])
      await sendJamieChatMessage(
        { runId: activeRun.id, text, imageRefs: refs },
        {
          onTextDelta: (t) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsgId ? { ...m, text: m.text + t } : m))
            ),
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsgId ? { ...m, streaming: false } : m))
            )
            // Refresh counters (image_count / chat_turn_count moved server-side).
            getActiveJamieRun(projectId).then((r) => r && setRun(r)).catch(() => {})
          },
          onError: (msg) => {
            setMessages((prev) => prev.filter((m) => m.id !== asstMsgId))
            toast.error(msg)
          },
        }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed.')
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, loading, run, projectId, userId, pendingFiles])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list).filter((f) => f.type.startsWith('image/'))
    if (imageLimit !== null && imagesUsed + incoming.length > imageLimit) {
      toast.error(`This session is limited to ${imageLimit} photos.`)
      return
    }
    setPendingFiles((prev) => [...prev, ...incoming])
  }

  const chip = run ? STATUS_CHIP[run.status] : null

  return (
    <div
      data-testid="jamie-chat-panel"
      className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px] sm:border-l sm:border-gray-200"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gold/15">
          <Sparkles className="h-4.5 w-4.5 text-brand-gold" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">Jamie Chat</h2>
          <p className="truncate text-[11px] text-gray-400">
            Tell me about the job. I&apos;ll handle the rest.
          </p>
        </div>
        {chip && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
              chip.className
            )}
          >
            {chip.icon && <chip.icon className="h-3 w-3" />}
            {chip.label}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Jamie Chat"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="mt-10 px-6 text-center text-sm text-gray-400">
            Describe the job — site conditions, what the client wants, rough
            dimensions. Add photos or a sketch if you have them.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'rounded-br-sm bg-blue-600 text-white'
                    : 'rounded-bl-sm bg-gray-100 text-gray-800'
                )}
              >
                {m.imageRefs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {m.imageRefs.map((ref) =>
                      signedUrls[ref] ? (
                        <img
                          key={ref}
                          src={signedUrls[ref]}
                          alt="Attached photo"
                          className="h-16 w-16 rounded-lg object-cover"
                        />
                      ) : (
                        <div key={ref} className="h-16 w-16 animate-pulse rounded-lg bg-black/10" />
                      )
                    )}
                  </div>
                )}
                <span className="whitespace-pre-wrap">
                  {m.text}
                  {m.streaming && <span className="animate-pulse">▍</span>}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 px-4 py-3">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-600"
              >
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            aria-label="Attach photos"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach photos"
            aria-label="Attach photos button"
            className="rounded-lg border border-gray-300 p-2.5 text-gray-500 transition-colors hover:bg-gray-50"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Message Jamie…"
            aria-label="Message Jamie"
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={streaming || loading || !input.trim()}
            aria-label="Send message"
            className="rounded-lg bg-brand-gold p-2.5 text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-right text-[11px] text-gray-400">
          {imageLimit !== null
            ? `${imagesUsed} of ${imageLimit} photos`
            : imagesUsed > 0
              ? `${imagesUsed} photo${imagesUsed === 1 ? '' : 's'}`
              : ''}
        </p>
      </div>
    </div>
  )
}

export default JamieChatPanel
