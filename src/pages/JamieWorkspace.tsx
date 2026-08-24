// Build with Jamie (J4) — the full-page estimating workspace.
//
// Replaces the J2 side panel. A drawer is for a helper; Jamie is the front
// door to building an estimate, and a drawer gave the contractor nowhere to
// look and nothing obvious to click. This screen puts the three things that
// matter side by side: the project's FILES (what she's reading), the
// CONVERSATION, and the REVIEW GATES where work areas and line items land.
//
// There is exactly ONE file repository per project — the Files tab. This
// screen only ever READS it; the old chat-panel photo uploader is gone.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  commitLineGate,
  commitWorkAreaGate,
  createJamieRun,
  getActiveJamieRun,
  setRunStatus,
  listJamieMessages,
  listProposedLines,
  listProposedWorkAreas,
  type JamieLoopRun,
  type JamieProposedLine,
  type JamieProposedWorkArea,
  type JamieRunStatus,
  type LineDecision,
  type WorkAreaDecision,
} from '@/lib/jamieLoop'
import { sendJamieChatMessage, type JamieAction } from '@/lib/jamieChat'
import { supabase } from '@/lib/supabase'
import type { LiveMarkupSettings } from '@/lib/money'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { LineGate, WorkAreaGate } from '@/components/jamie/GateReview'

interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}

interface WorkspaceFile {
  id: string
  file_name: string
  file_type: string
  mime_type: string | null
  anthropic_file_id: string | null
  anthropic_sync_error: string | null
}

const STATUS_CHIP: Record<
  JamieRunStatus,
  { label: string; className: string; icon?: typeof CircleCheck }
> = {
  in_progress:            { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  awaiting_wa_approval:   { label: 'Your review',          className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  awaiting_line_approval: { label: 'Your review',          className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  committed:              { label: 'Committed',            className: 'bg-emerald-100 text-emerald-800 ring-emerald-200', icon: CircleCheck },
  rejected:               { label: 'Rejected',             className: 'bg-rose-100 text-rose-800 ring-rose-200', icon: CircleX },
  abandoned:              { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  error:                  { label: 'In progress',          className: 'bg-sky-100 text-sky-800 ring-sky-200' },
}

export default function JamieWorkspace() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [projectName, setProjectName] = useState('')
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [run, setRun] = useState<JamieLoopRun | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const [passChars, setPassChars] = useState<number | null>(null)
  const [stagedWas, setStagedWas] = useState<JamieProposedWorkArea[]>([])
  const [stagedGroups, setStagedGroups] = useState<
    Array<JamieProposedWorkArea & { lines: JamieProposedLine[] }>
  >([])
  const [existingNameById, setExistingNameById] = useState<Record<string, string>>({})
  const [gateBusy, setGateBusy] = useState(false)
  // My Numbers markups — Gate 2 shows BILLED prices, so it needs these.
  const [markups, setMarkups] = useState<LiveMarkupSettings>({
    markup_materials_percent: 0,
    markup_subs_percent: 0,
  })
  const threadRef = useRef<HTMLDivElement>(null)

  // ── Load project, files, and any run already in flight ──────────────
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: proj }, { data: fileRows }, active, { data: settings }] = await Promise.all([
          supabase.from('projects').select('name').eq('id', projectId).maybeSingle(),
          supabase
            .from('project_files')
            .select('id, file_name, file_type, mime_type, anthropic_file_id, anthropic_sync_error')
            .eq('project_id', projectId)
            .order('uploaded_at'),
          getActiveJamieRun(projectId),
          supabase
            .from('company_settings')
            .select('markup_materials_percent, markup_subs_percent')
            .maybeSingle(),
        ])
        if (cancelled) return
        setProjectName((proj?.name as string) ?? '')
        if (settings) setMarkups(settings as LiveMarkupSettings)
        setFiles((fileRows ?? []) as WorkspaceFile[])
        if (active) {
          setRun(active)
          const rows = await listJamieMessages(active.id)
          if (cancelled) return
          setMessages(
            rows.map((m) => ({ id: m.id, role: m.role, text: m.content.text ?? '' }))
          )
        }
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // ── Gate data, keyed off the run's status ───────────────────────────
  const runStatus = run?.status
  const runId = run?.id
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    ;(async () => {
      try {
        if (runStatus === 'awaiting_wa_approval') {
          const [staged, { data: own }] = await Promise.all([
            listProposedWorkAreas(runId),
            supabase.from('work_areas').select('id, name').eq('project_id', projectId),
          ])
          if (cancelled) return
          setStagedWas(staged.filter((s) => s.status === 'pending'))
          setExistingNameById(
            Object.fromEntries(
              ((own ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name])
            )
          )
          setStagedGroups([])
        } else if (runStatus === 'awaiting_line_approval') {
          const groups = await listProposedLines(runId)
          if (cancelled) return
          setStagedGroups(
            groups
              .map((g) => ({ ...g, lines: g.lines.filter((l) => l.status === 'pending') }))
              .filter((g) => g.lines.length > 0)
          )
          setStagedWas([])
        } else {
          if (cancelled) return
          setStagedWas([])
          setStagedGroups([])
        }
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Couldn't load the review.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId, runStatus, projectId])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, stagedWas, stagedGroups])

  // ── Sending ─────────────────────────────────────────────────────────
  const send = useCallback(
    async (action: JamieAction, text: string) => {
      if (streaming || loading) return
      setStreaming(true)
      if (action !== 'chat') setPassChars(0)
      try {
        let activeRun = run
        if (!activeRun) {
          activeRun = (await getActiveJamieRun(projectId)) ?? (await createJamieRun(projectId))
          setRun(activeRun)
        }
        const userMsgId = crypto.randomUUID()
        const asstMsgId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          ...(text ? [{ id: userMsgId, role: 'user' as const, text }] : []),
          { id: asstMsgId, role: 'assistant' as const, text: '', streaming: true },
        ])
        setInput('')
        await sendJamieChatMessage(
          { runId: activeRun.id, text, action },
          {
            onTextDelta: (t) =>
              setMessages((prev) =>
                prev.map((m) => (m.id === asstMsgId ? { ...m, text: m.text + t } : m))
              ),
            onProgress: (chars) => setPassChars(chars),
            onStaged: () => setPassChars(null),
            onDone: () => {
              setMessages((prev) =>
                prev.map((m) => (m.id === asstMsgId ? { ...m, streaming: false } : m))
              )
              getActiveJamieRun(projectId).then((r) => r && setRun(r)).catch(() => {})
              // A pass syncs files server-side; refresh so any newly
              // unreadable file surfaces in the rail.
              supabase
                .from('project_files')
                .select('id, file_name, file_type, mime_type, anthropic_file_id, anthropic_sync_error')
                .eq('project_id', projectId)
                .order('uploaded_at')
                .then(({ data }) => data && setFiles(data as WorkspaceFile[]))
            },
            onError: (msg) => {
              setMessages((prev) => prev.filter((m) => m.id !== asstMsgId))
              toast.error(msg)
            },
          }
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Jamie hit a snag.')
      } finally {
        setStreaming(false)
        setPassChars(null)
      }
    },
    [run, streaming, loading, projectId]
  )

  const handleWorkAreaGate = useCallback(
    async (decisions: WorkAreaDecision[]) => {
      if (!run) return
      setGateBusy(true)
      try {
        const created = await commitWorkAreaGate(run.id, decisions)
        toast.success(`${created.length} work area${created.length === 1 ? '' : 's'} added.`)
        const fresh = await getActiveJamieRun(projectId)
        if (fresh) setRun(fresh)
        await send('propose_lines', '')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add the work areas.")
      } finally {
        setGateBusy(false)
      }
    },
    [run, projectId, send]
  )

  const handleLineGate = useCallback(
    async (decisions: LineDecision[], descriptions: Record<string, string>) => {
      if (!run) return
      setGateBusy(true)
      try {
        const { written, catalogAdded } = await commitLineGate(
          run.id,
          decisions,
          descriptions
        )
        toast.success(
          `${written} line${written === 1 ? '' : 's'} added to the estimate.` +
            (catalogAdded
              ? ` ${catalogAdded} new item${catalogAdded === 1 ? '' : 's'} saved to your catalog.`
              : '')
        )
        const fresh = await getActiveJamieRun(projectId)
        setRun(fresh ?? { ...run, status: 'committed' })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add the lines.")
      } finally {
        setGateBusy(false)
      }
    },
    [run, projectId]
  )

  /**
   * Abandon this run and start clean. Needed because history is replayed
   * verbatim: a run that began before Jamie could read project files still
   * carries her "I don't see anything attached" reply, and she'll believe
   * it. The run is marked abandoned, never deleted — the messages and any
   * staged rows stay for the audit trail.
   */
  const startOver = useCallback(async () => {
    if (!run || streaming || gateBusy) return
    setGateBusy(true)
    try {
      await setRunStatus(run.id, 'abandoned')
      const fresh = await createJamieRun(projectId)
      setRun(fresh)
      setMessages([])
      setStagedWas([])
      setStagedGroups([])
      toast.success('Started a fresh session.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start over.")
    } finally {
      setGateBusy(false)
    }
  }, [run, streaming, gateBusy, projectId])

  const chip = run ? STATUS_CHIP[run.status] : null
  // Readable = "Jamie will read this", NOT "already uploaded to Anthropic".
  // The sync is lazy — it runs on the first message — so counting synced
  // files made a fresh workspace announce "0 of 4 project files", which is
  // the exact "she can't see my plans" scare this whole change exists to
  // kill. A file only stops being readable when it has a sync error.
  const readable = files.filter((f) => !f.anthropic_sync_error)
  const unreadable = files.filter((f) => f.anthropic_sync_error)
  const atGate = stagedWas.length > 0 || stagedGroups.length > 0
  const canPropose =
    !!run && run.status === 'in_progress' && messages.length > 0 && !atGate && !streaming

  if (!user) return null

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(`/app/projects/${projectId}`)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </button>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gold/15">
          <Sparkles className="h-4.5 w-4.5 text-brand-gold" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold text-gray-900">
            Build with Jamie
            {projectName && <span className="font-normal text-gray-400"> · {projectName}</span>}
          </h1>
        </div>
        {run && messages.length > 0 && (
          <button
            type="button"
            onClick={() => void startOver()}
            disabled={streaming || gateBusy}
            title="Abandon this session and start a fresh one"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start over
          </button>
        )}
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
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Files rail — what Jamie is reading. Read-only on purpose. */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50/60 lg:flex">
          <div className="border-b border-gray-200 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Jamie is reading
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {unreadable.length === 0
                ? `${files.length} project file${files.length === 1 ? '' : 's'}`
                : `${readable.length} of ${files.length} project file${files.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {files.length === 0 ? (
              <p className="px-2 py-3 text-[12px] leading-relaxed text-gray-400">
                No files on this project yet. Add plans, the bid form, or site
                photos on the Files tab and Jamie picks them up automatically.
              </p>
            ) : (
              files.map((f) => {
                const ok = !f.anthropic_sync_error
                const Icon = (f.mime_type ?? '').startsWith('image/') ? ImageIcon : FileText
                return (
                  <div
                    key={f.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2 py-1.5',
                      ok ? 'text-gray-700' : 'text-gray-400'
                    )}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="break-words text-[12px] leading-snug">{f.file_name}</p>
                      {!ok && f.anthropic_sync_error && (
                        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
                          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                          {f.anthropic_sync_error}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t border-gray-200 px-4 py-3">
            <Link
              to={`/app/projects/${projectId}?tab=files`}
              className="text-[12px] font-semibold text-blue-600 hover:text-blue-700"
            >
              Add or manage files →
            </Link>
            {unreadable.length > 0 && (
              <p className="mt-1.5 text-[11px] text-gray-400">
                {unreadable.length} file{unreadable.length === 1 ? '' : 's'} Jamie
                can&apos;t read.
              </p>
            )}
          </div>
        </aside>

        {/* Conversation + gates */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            <div className="mx-auto max-w-3xl space-y-4">
              {loading ? (
                <div className="flex justify-center py-10 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h2 className="text-base font-bold text-gray-900">
                    Tell me about the job.
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                    {files.length > 0 ? (
                      <>
                        I&apos;ve got {readable.length} file
                        {readable.length === 1 ? '' : 's'} open for this project
                        already — plans, specs, whatever you uploaded. Tell me what
                        the client wants and anything the drawings don&apos;t say,
                        and I&apos;ll break it into work areas and price it.
                      </>
                    ) : (
                      <>
                        Nothing is uploaded to this project yet. Drop the plans and
                        the bid form on the Files tab and I&apos;ll read them — or
                        just describe the job here and we&apos;ll start from that.
                      </>
                    )}
                  </p>
                  <p className="mt-3 text-[12px] text-gray-400">
                    How it goes: we talk → I propose the work areas → you approve
                    them → I build the priced takeoff → you approve that → it lands
                    on the estimate.
                  </p>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        m.role === 'user'
                          ? 'rounded-br-sm bg-blue-600 text-white'
                          : 'rounded-bl-sm bg-gray-100 text-gray-800'
                      )}
                    >
                      <span className="whitespace-pre-wrap">
                        {m.text}
                        {m.streaming && !m.text && (
                          <span className="text-gray-500">
                            {passChars !== null
                              ? `Jamie is working through the job${passChars > 0 ? ` — ${passChars.toLocaleString()} characters in` : '…'}`
                              : 'Jamie is reading…'}
                          </span>
                        )}
                        {m.streaming && <span className="animate-pulse">▍</span>}
                      </span>
                    </div>
                  </div>
                ))
              )}

              {stagedWas.length > 0 && !streaming && (
                <WorkAreaGate
                  items={stagedWas}
                  existingNameById={existingNameById}
                  busy={gateBusy}
                  onCommit={(d) => void handleWorkAreaGate(d)}
                />
              )}
              {stagedGroups.length > 0 && !streaming && (
                <LineGate
                  groups={stagedGroups}
                  markups={markups}
                  busy={gateBusy}
                  onCommit={(d, desc) => void handleLineGate(d, desc)}
                />
              )}

              {run?.status === 'committed' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <p className="text-sm font-semibold text-emerald-900">
                    It&apos;s on the estimate.
                  </p>
                  <Link
                    to={`/app/projects/${projectId}?tab=work_areas`}
                    className="mt-1.5 inline-block text-[12px] font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Open the work areas to price and approve →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Composer — text only. Files live on the Files tab, one repository. */}
          <div className="border-t border-gray-200 px-4 py-3 sm:px-8">
            <div className="mx-auto max-w-3xl">
              {canPropose && (
                <button
                  type="button"
                  onClick={() => void send('propose_work_areas', '')}
                  className="mb-2 w-full rounded-lg border border-brand-gold/40 bg-brand-gold/10 py-2.5 text-sm font-semibold text-brand-gold-dark transition-colors hover:bg-brand-gold/20"
                >
                  Propose work areas
                </button>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (input.trim()) void send('chat', input.trim())
                    }
                  }}
                  placeholder="Tell Jamie about the job…"
                  aria-label="Message Jamie"
                  disabled={streaming}
                  className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => input.trim() && void send('chat', input.trim())}
                  disabled={streaming || loading || !input.trim()}
                  aria-label="Send message"
                  className="rounded-lg bg-brand-gold p-2.5 text-white shadow-sm transition-all hover:bg-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {streaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                Jamie reads every file on this project. Add them on the Files tab —
                there&apos;s only one place to upload.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
