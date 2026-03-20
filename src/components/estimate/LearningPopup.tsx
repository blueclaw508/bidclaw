// Jamie Learning Popup — shown when user edits Jamie's suggested components
import { useState } from 'react'
import { Bot, X } from 'lucide-react'
import type { LearningChoice } from '@/lib/learningEngine'

interface LearningPopupProps {
  workAreaName: string
  editCount: number
  onSave: (choice: LearningChoice) => void
  onClose: () => void
}

export function LearningPopup({ workAreaName, editCount, onSave, onClose }: LearningPopupProps) {
  const [choice, setChoice] = useState<LearningChoice>('confirm')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bot size={20} className="text-[#1e40af]" />
            <h3 className="text-base font-semibold text-slate-900">Jamie noticed you made changes</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-4 text-sm text-slate-600">
            You modified the <strong>{workAreaName}</strong> components ({editCount} change{editCount !== 1 ? 's' : ''}).
            Should I remember these changes for future estimates?
          </p>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
              <input
                type="radio"
                name="learning"
                value="always"
                checked={choice === 'always'}
                onChange={() => setChoice('always')}
                className="mt-0.5 accent-[#1e40af]"
              />
              <div>
                <span className="text-sm font-medium text-slate-800">Yes — always use these components</span>
                <p className="text-xs text-slate-500">I'll apply this automatically on future estimates</p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
              <input
                type="radio"
                name="learning"
                value="confirm"
                checked={choice === 'confirm'}
                onChange={() => setChoice('confirm')}
                className="mt-0.5 accent-[#1e40af]"
              />
              <div>
                <span className="text-sm font-medium text-slate-800">Yes — but confirm with me next time</span>
                <p className="text-xs text-slate-500">I'll suggest this but let you approve it first</p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
              <input
                type="radio"
                name="learning"
                value="job_specific"
                checked={choice === 'job_specific'}
                onChange={() => setChoice('job_specific')}
                className="mt-0.5 accent-[#1e40af]"
              />
              <div>
                <span className="text-sm font-medium text-slate-800">No — this was job-specific</span>
                <p className="text-xs text-slate-500">Don't apply these changes to other estimates</p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button
            onClick={() => onSave(choice)}
            className="rounded-lg bg-[#1e40af] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1e3a8a] transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
