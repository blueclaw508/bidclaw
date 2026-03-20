// Jamie's Learned Patterns — Settings panel
// Shows all installation patterns Jamie has learned from user edits

import { useState, useEffect } from 'react'
import { Bot, Trash2, Star, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getUserPatterns, deletePattern } from '@/lib/learningEngine'
import type { InstallationPattern } from '@/lib/learningEngine'
import { toast } from 'sonner'

export default function LearnedPatterns() {
  const { user } = useAuth()
  const [patterns, setPatterns] = useState<InstallationPattern[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadPatterns()
  }, [user])

  async function loadPatterns() {
    if (!user) return
    setLoading(true)
    const data = await getUserPatterns(user.id)
    setPatterns(data)
    setLoading(false)
  }

  async function handleDelete(id: string) {
    await deletePattern(id)
    setPatterns((prev) => prev.filter((p) => p.id !== id))
    toast.success('Pattern deleted')
  }

  function renderStars(confidence: number) {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          size={14}
          className={i <= confidence ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}
        />
      )
    }
    return <div className="flex gap-0.5">{stars}</div>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Bot size={20} className="text-[#1e40af]" />
        <h3 className="text-lg font-semibold text-slate-900">Jamie's Learned Patterns</h3>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        These are installation component patterns Jamie has learned from your edits.
        Patterns with 5 stars are applied automatically as Company Standards.
      </p>

      {patterns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center">
          <Bot size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-400">
            No patterns learned yet. Jamie learns as you edit estimates.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Trigger Item</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Components</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Confidence</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Source</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((pattern) => (
                <tr key={pattern.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 capitalize">{pattern.trigger_item}</span>
                      {pattern.confidence >= 5 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Company Standard
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {(pattern.learned_components ?? []).length} component{(pattern.learned_components ?? []).length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3">
                    {renderStars(pattern.confidence)}
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">
                    {pattern.source?.replace('_', ' ') ?? 'User edits'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(pattern.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                      title="Delete pattern"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
