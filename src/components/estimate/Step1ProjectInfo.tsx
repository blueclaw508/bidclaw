import { useState, useRef, useCallback } from 'react'
import type { EstimateRecord } from '@/lib/types'
import type { JamieMessage } from '@/lib/jamie'
import { JamieChatPanel } from './JamieChatPanel'
import { PlanMeasure } from './PlanMeasure'
import type { Measurement } from './PlanMeasure'
import {
  Upload,
  X,
  FileText,
  Image,
  Plus,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Bot,
  Ruler,
} from 'lucide-react'

interface Step1ProjectInfoProps {
  estimate: EstimateRecord | null
  onGenerate: (data: {
    client_name: string
    project_address: string
    project_description: string
    files: File[]
  }) => void
  onBack?: () => void
  // Jamie props
  jamieMessages?: JamieMessage[]
  jamieLoading?: boolean
  jamieBuildingEstimate?: boolean
  onJamieStart?: () => void
  onJamieSendMessage?: (text: string) => void
  onJamieBuildEstimate?: () => void
}

interface UploadedFile {
  file: File
  preview: string | null
  pageCount?: number
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
]

function ProgressIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: 'Project Info' },
    { num: 2, label: 'Work Areas' },
    { num: 3, label: 'Line Items' },
    { num: 4, label: 'Send' },
  ]

  return (
    <div className="mb-8 flex items-center justify-center gap-1">
      {steps.map((step, idx) => (
        <div key={step.num} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                step.num === currentStep
                  ? 'bg-[#2563EB] text-white'
                  : step.num < currentStep
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-200 text-slate-400'
              }`}
            >
              {step.num}
            </div>
            <span
              className={`hidden sm:inline text-sm font-medium ${
                step.num === currentStep ? 'text-[#2563EB]' : 'text-slate-400'
              }`}
            >
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`mx-3 h-0.5 w-8 sm:w-12 ${
                step.num < currentStep ? 'bg-green-500' : 'bg-slate-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function FilePreview({ file, onRemove, onMeasure }: { file: UploadedFile; onRemove: () => void; onMeasure?: () => void }) {
  const isPdf = file.file.type === 'application/pdf'
  const isImage = file.file.type.startsWith('image/')

  return (
    <div className="group relative flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-blue-200">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50">
        {file.preview ? (
          <img
            src={file.preview}
            alt={file.file.name}
            className="h-12 w-12 rounded-lg object-cover"
          />
        ) : isPdf ? (
          <FileText size={24} className="text-red-500" />
        ) : (
          <Image size={24} className="text-blue-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700">{file.file.name}</p>
        <p className="text-xs text-slate-400">
          {(file.file.size / 1024).toFixed(0)} KB
          {file.pageCount ? ` \u00B7 ${file.pageCount} page${file.pageCount !== 1 ? 's' : ''}` : ''}
        </p>
      </div>
      {isImage && onMeasure && (
        <button
          onClick={onMeasure}
          className="flex-shrink-0 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-[#2563EB] hover:text-white transition-colors"
          title="Open measurement tool"
        >
          <Ruler size={12} />
          Measure
        </button>
      )}
      <button
        onClick={onRemove}
        className="flex-shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
        aria-label={`Remove ${file.file.name}`}
      >
        <X size={16} />
      </button>
    </div>
  )
}

export { ProgressIndicator }

export function Step1ProjectInfo({
  estimate, onGenerate, onBack,
  jamieMessages, jamieLoading, jamieBuildingEstimate,
  onJamieStart, onJamieSendMessage, onJamieBuildEstimate,
}: Step1ProjectInfoProps) {
  const [showJamie, setShowJamie] = useState(false)
  const [clientName, setClientName] = useState(estimate?.client_name ?? '')
  const [projectAddress, setProjectAddress] = useState(estimate?.project_address ?? '')
  const [projectDescription, setProjectDescription] = useState(estimate?.project_description ?? '')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [measureImageUrl, setMeasureImageUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isRegenerate = estimate !== null && (estimate.work_areas?.length ?? 0) > 0

  const processFiles = useCallback((files: FileList | File[]) => {
    const newFiles: UploadedFile[] = []
    Array.from(files).forEach((file) => {
      if (!ACCEPTED_TYPES.includes(file.type)) return
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      newFiles.push({ file, preview })
    })
    setUploadedFiles((prev) => [...prev, ...newFiles])
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files)
        e.target.value = ''
      }
    },
    [processFiles]
  )

  const removeFile = useCallback((index: number) => {
    setUploadedFiles((prev) => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleSubmit = () => {
    if (!clientName.trim()) return

    if (isRegenerate && !showRegenerateConfirm) {
      setShowRegenerateConfirm(true)
      return
    }

    onGenerate({
      client_name: clientName.trim(),
      project_address: projectAddress.trim(),
      project_description: projectDescription.trim(),
      files: uploadedFiles.map((f) => f.file),
    })
    setShowRegenerateConfirm(false)
  }

  const canSubmit = clientName.trim().length > 0

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={1} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-blue-900">Project Information</h2>
          {onJamieStart && !showJamie && !isRegenerate && (
            <button
              onClick={() => { setShowJamie(true); onJamieStart() }}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#1e3a8a] to-[#1e40af] px-4 py-2 text-sm font-semibold text-white hover:from-[#1e40af] hover:to-[#2563eb] shadow-sm transition-all"
            >
              <Bot size={16} />
              Start with Jamie
            </button>
          )}
        </div>

        {/* Jamie Chat Panel */}
        {showJamie && jamieMessages && onJamieSendMessage && onJamieBuildEstimate && (
          <div className="mb-6">
            <JamieChatPanel
              messages={jamieMessages}
              onSendMessage={onJamieSendMessage}
              onComplete={onJamieBuildEstimate}
              onClose={() => setShowJamie(false)}
              loading={jamieLoading ?? false}
              buildingEstimate={jamieBuildingEstimate ?? false}
            />
          </div>
        )}

        {/* Client Name */}
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Client Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Johnson Residence"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* Project Address */}
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Project Address</label>
          <input
            type="text"
            value={projectAddress}
            onChange={(e) => setProjectAddress(e.target.value)}
            placeholder="e.g. 123 Main St, Austin, TX 78701"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* Project Description */}
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Project Description / Scope Notes
          </label>
          <p className="mb-1.5 text-xs text-slate-400">
            The more detail you provide, the better Jamie's estimate will be.
          </p>
          <textarea
            value={projectDescription}
            onChange={(e) => setProjectDescription(e.target.value)}
            placeholder="Describe the project scope, special requirements, site conditions, etc."
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-y"
          />
        </div>

        {/* File Upload */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Project Plans & Documents
          </label>
          <p className="mb-3 text-xs text-slate-400">
            Upload PDF plans, images, or photos. Multiple files supported.
          </p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragActive
                ? 'border-[#2563EB] bg-blue-50'
                : 'border-slate-300 bg-slate-50 hover:border-[#2563EB] hover:bg-blue-50/50'
            }`}
          >
            <Upload
              size={32}
              className={`mx-auto mb-3 ${dragActive ? 'text-[#2563EB]' : 'text-slate-400'}`}
            />
            <p className="text-sm font-medium text-slate-600">
              Drag & drop files here, or{' '}
              <span className="text-[#2563EB] underline">browse</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">PDF, PNG, JPG, WebP, TIFF</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Uploaded files list */}
          {uploadedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {uploadedFiles.map((f, idx) => (
                <FilePreview
                  key={`${f.file.name}-${idx}`}
                  file={f}
                  onRemove={() => removeFile(idx)}
                  onMeasure={f.preview ? () => setMeasureImageUrl(f.preview!) : undefined}
                />
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors"
              >
                <Plus size={14} />
                Add More Plans
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          {onBack ? (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegenerate ? (
              <>
                <RefreshCw size={16} />
                Regenerate Estimate
              </>
            ) : (
              <>
                Generate Estimate
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>

        {/* Regenerate confirmation dialog */}
        {showRegenerateConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                  <AlertTriangle size={20} className="text-yellow-600" />
                </div>
                <h3 className="text-lg font-bold text-blue-900">Regenerate Estimate?</h3>
              </div>
              <p className="mb-6 text-sm text-slate-600">
                This will replace all existing work areas and line items with newly generated ones.
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRegenerateConfirm(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onGenerate({
                      client_name: clientName.trim(),
                      project_address: projectAddress.trim(),
                      project_description: projectDescription.trim(),
                      files: uploadedFiles.map((f) => f.file),
                    })
                    setShowRegenerateConfirm(false)
                  }}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Plan Measure overlay */}
      {measureImageUrl && (
        <PlanMeasure
          imageUrl={measureImageUrl}
          measurements={measurements}
          onMeasurementsChange={setMeasurements}
          onClose={() => setMeasureImageUrl(null)}
        />
      )}
    </div>
  )
}
