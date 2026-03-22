import { useState } from 'react'
import type { WorkAreaData } from '@/lib/types'
import { ProgressIndicator } from './Step1ProjectInfo'
import { WorkAreaCard } from './WorkAreaCard'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Loader2,
  FileSearch,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

interface Step2WorkAreasProps {
  workAreas: WorkAreaData[]
  loading: boolean
  loadingMessage: string
  onUpdateWorkArea: (id: string, updates: Partial<WorkAreaData>) => void
  onRemoveWorkArea: (id: string) => void
  onAddWorkArea: () => void
  onApprove: () => void
  onBack: () => void
}

const loadingStages = [
  { message: 'Reading your project plans...', icon: FileSearch },
  { message: 'Identifying work areas...', icon: Layers },
  { message: 'Work areas ready for review', icon: CheckCircle2 },
]

function LoadingAnimation({ message }: { message: string }) {
  const stageIndex = loadingStages.findIndex((s) => s.message === message)
  const currentIndex = stageIndex >= 0 ? stageIndex : 0

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative mb-8">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-slate-200 border-t-[#2563EB]" />
      </div>

      <div className="space-y-3">
        {loadingStages.map((stage, idx) => {
          const Icon = stage.icon
          const isActive = idx === currentIndex
          const isComplete = idx < currentIndex

          return (
            <div
              key={stage.message}
              className={`flex items-center gap-3 transition-opacity ${
                isActive ? 'opacity-100' : isComplete ? 'opacity-60' : 'opacity-30'
              }`}
            >
              {isComplete ? (
                <CheckCircle2 size={18} className="text-green-500" />
              ) : isActive ? (
                <Loader2 size={18} className="animate-spin text-[#2563EB]" />
              ) : (
                <Icon size={18} className="text-slate-300" />
              )}
              <span
                className={`text-sm font-medium ${
                  isActive ? 'text-blue-900' : isComplete ? 'text-slate-500' : 'text-slate-300'
                }`}
              >
                {stage.message}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Step2WorkAreas({
  workAreas,
  loading,
  loadingMessage,
  onUpdateWorkArea,
  onRemoveWorkArea,
  onAddWorkArea,
  onApprove,
  onBack,
}: Step2WorkAreasProps) {
  const [showBackConfirm, setShowBackConfirm] = useState(false)

  const handleBack = () => {
    if (workAreas.length > 0) {
      setShowBackConfirm(true)
    } else {
      onBack()
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={2} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-blue-900">Work Areas</h2>
            <p className="text-sm text-slate-500">
              {loading
                ? 'Jamie is analyzing your project...'
                : `${workAreas.length} work area${workAreas.length !== 1 ? 's' : ''} identified`}
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingAnimation message={loadingMessage} />
        ) : (
          <>
            {/* Work area cards */}
            <div className="space-y-4">
              {workAreas.map((wa) => (
                <WorkAreaCard
                  key={wa.id}
                  workArea={wa}
                  onUpdate={(updates) => onUpdateWorkArea(wa.id, updates)}
                  onRemove={() => onRemoveWorkArea(wa.id)}
                />
              ))}
            </div>

            {/* Add work area */}
            <button
              onClick={onAddWorkArea}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-medium text-slate-500 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
            >
              <Plus size={16} />
              Add Work Area
            </button>

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
              <button
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft size={16} />
                Back to Project Info
              </button>

              <button
                onClick={onApprove}
                disabled={workAreas.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve Work Areas & Build Estimate
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Back confirmation dialog */}
      {showBackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">Go Back?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Going back to Project Info will discard your current work areas. Are you sure?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBackConfirm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Stay Here
              </button>
              <button
                onClick={() => {
                  setShowBackConfirm(false)
                  onBack()
                }}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
