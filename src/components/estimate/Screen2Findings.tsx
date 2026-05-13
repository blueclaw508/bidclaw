// ============================================================
// v3 Screen 2 — Jamie's Findings
// Three sections: extraction summary, proposed work areas,
// dynamic questions. User confirms, Jamie estimates.
// ============================================================

import { useState, useRef, useEffect } from 'react'
import type { V2Pass1Extraction, V2Pass1ProposedWorkArea, V2Pass1Question } from '@/lib/types'
import type { Pass2V2Progress } from '@/lib/pass2V2'
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  Check,
  Pencil,
  ChevronDown,
  ChevronUp,
  Eye,
  HelpCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react'

// ── Types ──

interface ConfirmedWorkArea {
  name: string
  summary: string
  selected: boolean
  isCustom: boolean  // user-added, not Jamie-proposed
}

interface Screen2FindingsProps {
  pass1Extraction: V2Pass1Extraction
  pass2Loading: boolean
  pass2Progress: Pass2V2Progress | null
  pass2Error: string | null
  onEstimate: (
    workAreas: { name: string; summary: string }[],
    questionAnswers: { question: string; answer: string }[]
  ) => Promise<void>
  onBack: () => void
}

// ── Section A: What Jamie Found ──

function FindingsSummary({ extraction }: { extraction: V2Pass1Extraction }) {
  const [expanded, setExpanded] = useState(true)

  // Group findings by category
  const groups: { label: string; items: string[] }[] = []

  if (extraction.dimensions?.length) {
    groups.push({
      label: 'Dimensions spotted',
      items: extraction.dimensions.map(d => `${d.item}: ${d.value}`),
    })
  }
  if (extraction.materials?.length) {
    groups.push({
      label: 'Materials identified',
      items: extraction.materials.map(m => `${m.item}${m.spec ? ` — ${m.spec}` : ''}`),
    })
  }
  if (extraction.quantities?.length) {
    groups.push({
      label: 'Quantities & counts',
      items: extraction.quantities.map(q => `(${q.count}) ${q.item}${q.size ? ` — ${q.size}` : ''}`),
    })
  }
  if (extraction.areas_zones?.length) {
    groups.push({
      label: 'Areas & zones',
      items: extraction.areas_zones.map(z => `${z.name}${z.approx_sf ? ` (~${z.approx_sf} SF)` : ''}`),
    })
  }
  if (extraction.unknowns?.length) {
    groups.push({
      label: 'Could not determine',
      items: extraction.unknowns.map(u => `${u.item} — ${u.note}`),
    })
  }

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0)
  if (totalItems === 0) return null

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Eye size={18} className="text-[#2563EB]" />
          <span className="text-sm font-semibold text-blue-900">
            What Jamie found
          </span>
          <span className="rounded-full bg-[#2563EB] px-2 py-0.5 text-xs font-bold text-white">
            {totalItems}
          </span>
          <span className="text-xs text-slate-400">
            across {extraction.plans_analyzed} plan sheet{extraction.plans_analyzed !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {groups.map((group, gIdx) => (
            <div key={gIdx}>
              <p className={`text-xs font-semibold mb-1 ${
                group.label === 'Could not determine' ? 'text-amber-700' : 'text-slate-600'
              }`}>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item, iIdx) => (
                  <div key={iIdx} className={`flex items-start gap-2 text-sm ${
                    group.label === 'Could not determine' ? 'text-amber-600' : 'text-slate-700'
                  }`}>
                    <span className="mt-0.5 text-[#2563EB]">&bull;</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {extraction.scale && (
            <div className="text-xs text-slate-500 border-t border-blue-200 pt-2">
              Scale: {extraction.scale}
            </div>
          )}
          {extraction.existing_conditions?.length ? (
            <div className="border-t border-blue-200 pt-2">
              <p className="text-xs font-semibold text-slate-600 mb-1">Existing Conditions</p>
              {extraction.existing_conditions.map((ec, idx) => (
                <div key={idx} className="text-xs text-slate-500">
                  &bull; {ec.item} — {ec.note}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ── Section B: Proposed Work Areas ──

function WorkAreaCard({
  wa,
  onToggle,
  onRename,
  onRemove,
  disabled,
}: {
  wa: ConfirmedWorkArea
  onToggle: () => void
  onRename: (name: string) => void
  onRemove: () => void
  disabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(wa.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const handleSaveRename = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== wa.name) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div className={`rounded-xl border px-4 py-3 transition-colors ${
      wa.selected
        ? 'border-[#2563EB] bg-blue-50/30'
        : 'border-slate-200 bg-slate-50 opacity-60'
    }`}>
      <div className="flex items-center gap-3">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          disabled={disabled}
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
            wa.selected
              ? 'border-[#2563EB] bg-[#2563EB] text-white'
              : 'border-slate-300 bg-white hover:border-slate-400'
          } disabled:opacity-50`}
        >
          {wa.selected && <Check size={14} />}
        </button>

        {/* Name / edit */}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') setEditing(false) }}
              className="w-full rounded border border-[#2563EB] px-2 py-1 text-sm font-semibold text-blue-900 outline-none focus:ring-2 focus:ring-[#2563EB]/20"
            />
          ) : (
            <>
              <span className="text-sm font-semibold text-blue-900">{wa.name}</span>
              {wa.summary && (
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{wa.summary}</p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {!editing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => { setEditName(wa.name); setEditing(true) }}
              disabled={disabled}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50"
              title="Rename"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onRemove}
              disabled={disabled}
              className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section C: Questions ──

function QuestionCard({
  question,
  answer,
  onAnswer,
  disabled,
}: {
  question: V2Pass1Question
  answer: string | null
  onAnswer: (answer: string) => void
  disabled: boolean
}) {
  const [customValue, setCustomValue] = useState('')

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <p className="text-sm text-slate-700 mb-3">{question.question}</p>

      <div className="flex flex-wrap gap-2">
        {(question.options ?? []).map((opt) => (
          <button
            key={opt}
            onClick={() => onAnswer(opt)}
            disabled={disabled}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              answer === opt
                ? 'border-[#2563EB] bg-[#2563EB] text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-[#2563EB] hover:text-[#2563EB]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {opt}
          </button>
        ))}

        {question.allow_custom && (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customValue.trim()) {
                  onAnswer(customValue.trim())
                }
              }}
              placeholder="Custom..."
              disabled={disabled}
              className={`w-24 rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 ${
                answer && answer !== '' && !(question.options ?? []).includes(answer)
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-slate-200'
              } disabled:opacity-50`}
            />
            {customValue.trim() && (
              <button
                onClick={() => { onAnswer(customValue.trim()); }}
                disabled={disabled}
                className="rounded-md bg-[#2563EB] p-1 text-white"
              >
                <Check size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {answer && (
        <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
          <Check size={12} />
          <span>{answer}</span>
        </div>
      )}
    </div>
  )
}

// ── Main Component ──

export function Screen2Findings({
  pass1Extraction,
  pass2Loading,
  pass2Progress,
  pass2Error,
  onEstimate,
  onBack,
}: Screen2FindingsProps) {
  // Initialize work areas from Jamie's proposals
  const [workAreas, setWorkAreas] = useState<ConfirmedWorkArea[]>(() => {
    return (pass1Extraction.proposed_work_areas ?? []).map((pwa: V2Pass1ProposedWorkArea) => ({
      name: pwa.name,
      summary: pwa.summary,
      selected: true,
      isCustom: false,
    }))
  })

  // Initialize question answers
  const [answers, setAnswers] = useState<Record<string, string>>({})

  // Add work area input
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  const selectedCount = workAreas.filter(wa => wa.selected).length
  const questions = pass1Extraction.questions ?? []
  const hasQuestions = questions.length > 0

  const handleToggle = (idx: number) => {
    setWorkAreas(prev => prev.map((wa, i) => i === idx ? { ...wa, selected: !wa.selected } : wa))
  }

  const handleRename = (idx: number, name: string) => {
    setWorkAreas(prev => prev.map((wa, i) => i === idx ? { ...wa, name } : wa))
  }

  const handleRemove = (idx: number) => {
    setWorkAreas(prev => prev.filter((_, i) => i !== idx))
  }

  const handleAddWorkArea = () => {
    const trimmed = addInput.trim()
    if (!trimmed) return
    const exists = workAreas.some(wa => wa.name.toLowerCase() === trimmed.toLowerCase())
    if (exists) return
    setWorkAreas(prev => [...prev, {
      name: trimmed,
      summary: '',
      selected: true,
      isCustom: true,
    }])
    setAddInput('')
    addInputRef.current?.focus()
  }

  const handleAnswer = (question: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [question]: answer }))
  }

  const handleEstimate = async () => {
    const selected = workAreas.filter(wa => wa.selected)
    const questionAnswers = Object.entries(answers).map(([question, answer]) => ({ question, answer }))
    await onEstimate(selected, questionAnswers)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={2} />

      <div className="space-y-6">
        {/* Section A: Findings */}
        <FindingsSummary extraction={pass1Extraction} />

        {/* Section B: Proposed Work Areas */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-blue-900">Jamie's proposed work areas</h2>
            <p className="text-sm text-slate-500">
              {workAreas.length > 0
                ? 'Confirm the work areas you want estimated. Rename or remove any.'
                : 'Jamie didn\'t propose any work areas. Add your own below.'}
            </p>
          </div>

          {/* Work area cards */}
          <div className="space-y-2 mb-4">
            {workAreas.map((wa, idx) => (
              <WorkAreaCard
                key={`${wa.name}-${idx}`}
                wa={wa}
                onToggle={() => handleToggle(idx)}
                onRename={(name) => handleRename(idx, name)}
                onRemove={() => handleRemove(idx)}
                disabled={pass2Loading}
              />
            ))}
          </div>

          {/* Add custom work area */}
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-slate-400 flex-shrink-0" />
            <input
              ref={addInputRef}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddWorkArea() }}
              placeholder="Add a work area Jamie missed..."
              disabled={pass2Loading}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-50"
            />
            <button
              onClick={handleAddWorkArea}
              disabled={!addInput.trim() || pass2Loading}
              className="rounded-lg bg-[#2563EB] px-3 py-2 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
            >
              Add
            </button>
          </div>
        </div>

        {/* Section C: Questions (conditional) */}
        {hasQuestions && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle size={18} className="text-amber-500" />
              <h2 className="text-lg font-bold text-blue-900">Jamie has a few questions</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              These help Jamie produce a more accurate estimate. Tap to answer.
            </p>

            <div className="space-y-3">
              {questions.map((q, idx) => (
                <QuestionCard
                  key={idx}
                  question={q}
                  answer={answers[q.question] ?? null}
                  onAnswer={(ans) => handleAnswer(q.question, ans)}
                  disabled={pass2Loading}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pass 2 error */}
        {pass2Error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              <p className="text-sm text-red-700">
                Jamie hit a snag — {pass2Error}. Try again or adjust your scope.
              </p>
            </div>
          </div>
        )}

        {/* Pass 2 progress */}
        {pass2Loading && pass2Progress && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-[#2563EB]" />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  Jamie is estimating {pass2Progress.currentWorkAreaName}...
                </p>
                <p className="text-xs text-slate-500">
                  {pass2Progress.completedCount} of {pass2Progress.totalCount} work areas complete
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-blue-100">
              <div
                className="h-1.5 rounded-full bg-[#2563EB] transition-all duration-500"
                style={{ width: `${(pass2Progress.completedCount / pass2Progress.totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            disabled={pass2Loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <ArrowLeft size={16} />
            Back to Upload
          </button>

          <button
            onClick={handleEstimate}
            disabled={selectedCount === 0 || pass2Loading}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pass2Loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Jamie is estimating...
              </>
            ) : (
              <>
                Estimate {selectedCount > 0 ? `${selectedCount} Work Area${selectedCount > 1 ? 's' : ''}` : 'These'}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
