import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, X } from 'lucide-react'
import type { JamieMessage } from '@/lib/jamie'
import { isIntakeComplete } from '@/lib/jamie'

// ── Jamie Avatar SVG (reusable at any size) ──
function JamieAvatar({ size = 52 }: { size?: number }) {
  const borderW = size > 30 ? 2 : 1.5
  const fontSize = size * 0.48
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className="flex-shrink-0">
      <defs>
        <filter id="ja-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.25" />
        </filter>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - borderW} fill="#0c1428" stroke="#3b82f6" strokeWidth={borderW} filter="url(#ja-shadow)" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="#fff"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize={fontSize}
      >
        J
      </text>
    </svg>
  )
}

interface JamieChatPanelProps {
  messages: JamieMessage[]
  onSendMessage: (text: string) => void
  onComplete: () => void
  onClose: () => void
  loading: boolean
  buildingEstimate: boolean
}

export function JamieChatPanel({
  messages,
  onSendMessage,
  onComplete,
  onClose,
  loading,
  buildingEstimate,
}: JamieChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const complete = isIntakeComplete(messages)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, buildingEstimate])

  useEffect(() => {
    if (!loading && !buildingEstimate) inputRef.current?.focus()
  }, [loading, buildingEstimate])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || loading || buildingEstimate) return
    onSendMessage(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-[#1e40af]/20 bg-white shadow-lg overflow-hidden" style={{ height: '520px' }}>
      {/* ── CHANGE 1: Bigger Blue Bar (~85px) ── */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#0c1428] to-[#1e40af] px-4 py-4" style={{ minHeight: '85px' }}>
        <div className="flex items-center gap-3">
          {/* ── Jamie Avatar (80×80) ── */}
          <JamieAvatar size={80} />
          <div>
            <h3 className="text-lg font-bold text-white leading-tight" style={{ fontSize: '22px' }}>Jamie</h3>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-blue-200 hover:bg-white/10 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/50">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#1e40af] text-white rounded-br-sm'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm shadow-sm'
              }`}
            >
              {/* ── CHANGE 3: Mini avatar in message bubble ── */}
              {msg.role === 'jamie' && (
                <div className="mb-2 flex items-center gap-2.5 text-sm font-bold text-[#1e40af]">
                  <JamieAvatar size={48} />
                  Jamie
                </div>
              )}
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-sm text-slate-500 shadow-sm">
              <Loader2 size={14} className="animate-spin text-[#1e40af]" />
              Jamie is thinking...
            </div>
          </div>
        )}

        {buildingEstimate && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-white border border-[#1e40af]/20 px-3.5 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-[#1e40af]">
                <Loader2 size={14} className="animate-spin" />
                Building your estimate...
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Matching catalog items, applying production rates, writing scope descriptions...
              </p>
            </div>
          </div>
        )}

        {complete && !buildingEstimate && (
          <div className="flex justify-center">
            <button
              onClick={onComplete}
              className="rounded-lg bg-[#1e40af] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1e3a8a] shadow-sm transition-colors"
            >
              Build Estimate from Interview
            </button>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 bg-white px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={complete ? 'Interview complete — build your estimate above' : 'Type your answer...'}
            disabled={loading || buildingEstimate || complete}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e40af] focus:ring-1 focus:ring-[#1e40af] disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || buildingEstimate || complete}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e40af] text-white hover:bg-[#1e3a8a] disabled:opacity-40 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
