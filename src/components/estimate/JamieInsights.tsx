import { useState } from 'react'
import { Bot, Loader2, CheckCircle2, AlertTriangle, FileText, PenLine, BarChart3 } from 'lucide-react'
import type { JamieAnalysisResult } from '@/lib/jamie'

// ── Jamie AI Suggestion Banner ──

export function JamieSuggestionBanner({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="rounded-lg border border-[#1e40af]/15 bg-blue-50/50">
      <div className="flex items-center gap-1.5 border-b border-[#1e40af]/10 px-3 py-1.5">
        <Bot size={12} className="text-[#1e40af]" />
        <span className="text-[10px] font-semibold text-[#1e40af] uppercase tracking-wider">
          {label ?? 'Jamie Suggestion'}
        </span>
      </div>
      <div className="px-3 py-2.5 text-sm text-slate-700 leading-relaxed">
        {children}
      </div>
    </div>
  )
}

// ── Scope Writer Button + Output ──

interface ScopeWriterProps {
  scope: string | null
  loading: boolean
  onWrite: () => void
  onUpdate: (scope: string) => void
}

export function JamieScopeWriter({ scope, loading, onWrite, onUpdate }: ScopeWriterProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(scope ?? '')

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#1e40af]/15 bg-blue-50/50 px-3 py-2.5 text-sm text-[#1e40af]">
        <Loader2 size={14} className="animate-spin" />
        Jamie is writing the scope...
      </div>
    )
  }

  if (scope) {
    return (
      <JamieSuggestionBanner label="Jamie Scope Description">
        {editing ? (
          <div>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-[#1e40af] focus:outline-none resize-y"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { onUpdate(editValue); setEditing(false) }}
                className="rounded-md bg-[#1e40af] px-3 py-1 text-xs font-medium text-white hover:bg-[#1e3a8a]"
              >
                Save
              </button>
              <button
                onClick={() => { setEditValue(scope); setEditing(false) }}
                className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="whitespace-pre-wrap">{scope}</p>
            <button
              onClick={() => { setEditValue(scope); setEditing(true) }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#1e40af] hover:text-[#1e3a8a]"
            >
              <PenLine size={10} /> Edit
            </button>
          </div>
        )}
      </JamieSuggestionBanner>
    )
  }

  return (
    <button
      onClick={onWrite}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e40af]/20 bg-blue-50 px-3 py-2 text-xs font-medium text-[#1e40af] hover:bg-blue-100 transition-colors"
    >
      <Bot size={14} />
      Write Scope with Jamie
    </button>
  )
}

// ── Estimate Summary Button + Output ──

interface SummaryProps {
  summary: string | null
  loading: boolean
  onGenerate: () => void
  onUpdate: (summary: string) => void
}

export function JamieEstimateSummary({ summary, loading, onGenerate, onUpdate }: SummaryProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(summary ?? '')

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#1e40af]/15 bg-blue-50/50 px-4 py-3 text-sm text-[#1e40af]">
        <Loader2 size={14} className="animate-spin" />
        Jamie is generating the estimate summary...
      </div>
    )
  }

  if (summary) {
    return (
      <JamieSuggestionBanner label="Jamie Estimate Summary">
        {editing ? (
          <div>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-[#1e40af] focus:outline-none resize-y"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { onUpdate(editValue); setEditing(false) }}
                className="rounded-md bg-[#1e40af] px-3 py-1 text-xs font-medium text-white hover:bg-[#1e3a8a]"
              >
                Save
              </button>
              <button
                onClick={() => { setEditValue(summary); setEditing(false) }}
                className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="whitespace-pre-wrap">{summary}</p>
            <button
              onClick={() => { setEditValue(summary); setEditing(true) }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#1e40af] hover:text-[#1e3a8a]"
            >
              <PenLine size={10} /> Edit
            </button>
          </div>
        )}
      </JamieSuggestionBanner>
    )
  }

  return (
    <button
      onClick={onGenerate}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e40af]/20 bg-blue-50 px-3 py-2 text-xs font-medium text-[#1e40af] hover:bg-blue-100 transition-colors"
    >
      <FileText size={14} />
      Generate Summary with Jamie
    </button>
  )
}

// ── Estimate Analysis Panel (Conversational) ──

interface AnalysisProps {
  analysis: JamieAnalysisResult | null
  loading: boolean
  onAnalyze: () => void
  // Conversational review props
  workAreaName?: string
  reviewMessages?: { role: 'jamie' | 'user'; content: string }[]
  reviewLoading?: boolean
  onStartReview?: () => void
  onSendReviewMessage?: (message: string) => void
}

export function JamieAnalysisPanel({
  analysis,
  loading,
  onAnalyze,
  workAreaName: _workAreaName,
  reviewMessages,
  reviewLoading,
  onStartReview,
  onSendReviewMessage,
}: AnalysisProps) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [userInput, setUserInput] = useState('')

  const handleStartReview = () => {
    setReviewOpen(true)
    onStartReview?.()
  }

  const handleSendMessage = () => {
    if (!userInput.trim()) return
    onSendReviewMessage?.(userInput.trim())
    setUserInput('')
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#1e40af]/15 bg-blue-50/50 px-4 py-3 text-sm text-[#1e40af]">
        <Loader2 size={14} className="animate-spin" />
        Jamie is checking your estimate for completeness...
      </div>
    )
  }

  // Conversational review panel
  if (reviewOpen && reviewMessages) {
    return (
      <JamieSuggestionBanner label="Jamie Analysis">
        <div className="space-y-3">
          {/* Conversation messages */}
          <div className="max-h-80 overflow-y-auto space-y-2">
            {reviewMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'jamie'
                    ? 'bg-white border border-slate-100 text-slate-700 whitespace-pre-wrap'
                    : 'bg-[#1e40af] text-white ml-8'
                }`}
              >
                {msg.content}
              </div>
            ))}
            {reviewLoading && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-[#1e40af]">
                <Loader2 size={12} className="animate-spin" />
                Jamie is thinking...
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask Jamie a question..."
              className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#1e40af] focus:outline-none"
            />
            <button
              onClick={handleSendMessage}
              disabled={!userInput.trim() || reviewLoading}
              className="rounded-md bg-[#1e40af] px-3 py-2 text-xs font-medium text-white hover:bg-[#1e3a8a] disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <button
            onClick={() => setReviewOpen(false)}
            className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Close Review
          </button>
        </div>
      </JamieSuggestionBanner>
    )
  }

  // Classic analysis result display
  if (analysis) {
    const statusIcon = analysis.overall_status === 'ok'
      ? <CheckCircle2 size={18} className="text-green-600" />
      : <AlertTriangle size={18} className="text-amber-600" />

    return (
      <JamieSuggestionBanner label="Jamie KYN Analysis">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className={`text-sm font-semibold ${analysis.overall_status === 'ok' ? 'text-green-700' : 'text-amber-700'}`}>
              {analysis.summary}
            </span>
          </div>

          {analysis.items.filter((i) => i.status !== 'ok').length > 0 && (
            <div className="space-y-1.5">
              {analysis.items
                .filter((i) => i.status !== 'ok')
                .map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-md bg-white border border-slate-100 px-3 py-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <div>
                      <span className="text-xs font-semibold text-slate-700">{item.line_item_name}</span>
                      <p className="text-xs text-slate-500">{item.message}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* No pricing warnings — BidClaw checks quantities only, QuickCalc handles pricing */}
        </div>
      </JamieSuggestionBanner>
    )
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={onAnalyze}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e40af]/20 bg-blue-50 px-3 py-2 text-xs font-medium text-[#1e40af] hover:bg-blue-100 transition-colors"
      >
        <BarChart3 size={14} />
        Jamie Analysis
      </button>
      {onStartReview && (
        <button
          onClick={handleStartReview}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e40af]/20 bg-blue-50 px-3 py-2 text-xs font-medium text-[#1e40af] hover:bg-blue-100 transition-colors"
        >
          <Bot size={14} />
          Review with Jamie
        </button>
      )}
    </div>
  )
}

// ── "Jamie Built This" Banner ──

export function JamieBuiltBanner() {
  return (
    <div className="rounded-lg border border-[#1e40af]/20 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Bot size={18} className="text-[#1e40af]" />
        <div>
          <p className="text-sm font-semibold text-[#1e40af]">Jamie built this estimate</p>
          <p className="text-xs text-slate-500">Review and adjust quantities, items, and scope before sending to QuickCalc.</p>
        </div>
      </div>
    </div>
  )
}
