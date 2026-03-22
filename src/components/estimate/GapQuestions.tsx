// Step 2.5 — Jamie's Gap Questions
// Displayed between Work Areas (Step 2) and Line Items (Step 3)
// when Jamie has questions to clarify before building the estimate.

import { useState } from 'react'
import { ArrowRight, ArrowLeft, MessageCircleQuestion, Loader2 } from 'lucide-react'
import { ProgressIndicator } from './Step1ProjectInfo'

interface GapQuestionsProps {
  questions: Record<string, string[]> // keyed by work area id
  workAreaNames: Record<string, string> // id → name
  onSubmit: (answers: Record<string, string>) => void
  onSkip: () => void
  onBack: () => void
  loading?: boolean
}

export function GapQuestions({
  questions,
  workAreaNames,
  onSubmit,
  onSkip,
  onBack,
  loading,
}: GapQuestionsProps) {
  // Flatten all questions into a flat list with source tracking
  const allQuestions: { waId: string; waName: string; question: string; key: string }[] = []
  for (const [waId, qs] of Object.entries(questions)) {
    for (const q of qs) {
      allQuestions.push({
        waId,
        waName: workAreaNames[waId] ?? waId,
        question: q,
        key: `${waId}::${q}`,
      })
    }
  }

  const [answers, setAnswers] = useState<Record<string, string>>({})

  const handleChange = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = () => {
    // Convert answers from key format back to question → answer
    const qaPairs: Record<string, string> = {}
    for (const item of allQuestions) {
      const answer = answers[item.key]?.trim()
      if (answer) {
        qaPairs[item.question] = answer
      }
    }
    onSubmit(qaPairs)
  }

  const answeredCount = allQuestions.filter((q) => answers[q.key]?.trim()).length

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={2} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Header with Jamie icon */}
        <div className="mb-6 flex items-center gap-4">
          <img
            src="/jamie-avatar.png"
            alt="Jamie"
            className="h-10 w-10 rounded-full object-cover flex-shrink-0"
          />
          <h2 className="text-lg font-bold text-blue-900">
            A few quick questions before I build this out.
          </h2>
        </div>

        {/* Questions grouped by work area */}
        <div className="space-y-6">
          {Object.entries(questions).map(([waId, qs]) => (
            <div key={waId}>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <MessageCircleQuestion size={16} className="text-blue-500" />
                {workAreaNames[waId] ?? waId}
              </h3>
              <div className="space-y-3 pl-6">
                {qs.map((q) => {
                  const key = `${waId}::${q}`
                  return (
                    <div key={key}>
                      <label className="mb-1 block text-sm text-slate-600">{q}</label>
                      <input
                        type="text"
                        value={answers[key] ?? ''}
                        onChange={(e) => handleChange(key, e.target.value)}
                        placeholder="Your answer..."
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Work Areas
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onSkip}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Skip — build with defaults
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Jamie is thinking...
                </>
              ) : (
                <>
                  Got it — build my estimate
                  {answeredCount > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
                      {answeredCount}/{allQuestions.length}
                    </span>
                  )}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
