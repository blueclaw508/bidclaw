import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, X } from 'lucide-react'
import type { JamieMessage } from '@/lib/jamie'
import { isIntakeComplete } from '@/lib/jamie'

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
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#0c1428] to-[#1e40af] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Jamie</h3>
            <p className="text-[10px] text-blue-200">Estimating Agent</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-blue-200 hover:bg-white/10 hover:text-white">
          <X size={16} />
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
              {msg.role === 'jamie' && (
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[#1e40af]">
                  <Bot size={10} /> Jamie
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
