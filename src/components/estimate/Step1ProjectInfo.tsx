import { useState, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
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
  Loader2,
} from 'lucide-react'

interface Step1ProjectInfoProps {
  estimate: EstimateRecord | null
  onGenerate: (data: {
    client_name: string
    first_name: string
    last_name: string
    company_name: string | null
    estimate_name: string | null
    phone: string | null
    email: string | null
    address_line: string
    city: string
    state: string
    zip: string
    project_address: string
    project_description: string
    files: File[]
  }) => void
  onBack?: () => void
  generating?: boolean
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
  const canMeasure = (isImage || isPdf) && onMeasure

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
      {canMeasure && (
        <button
          onClick={onMeasure}
          className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg bg-[#1e40af] px-5 py-2.5 text-base font-bold text-white hover:bg-[#2563EB] hover:brightness-110 active:scale-95 transition-all duration-100 shadow-md cursor-pointer"
          title="Open measurement tool"
        >
          <Ruler size={22} />
          📐 Measure from Plan
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

/** Render PDF page 1 as a data URL for the measure tool */
async function rasterizePdfPage1(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const scale = 150 / 72 // 150 DPI
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')
  await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise
  const dataUrl = canvas.toDataURL('image/png')
  pdf.destroy()
  return dataUrl
}

export function Step1ProjectInfo({
  estimate, onGenerate, onBack, generating,
  jamieMessages, jamieLoading, jamieBuildingEstimate,
  onJamieStart, onJamieSendMessage, onJamieBuildEstimate,
}: Step1ProjectInfoProps) {
  const [showJamie, setShowJamie] = useState(false)
  // Structured client fields
  const [firstName, setFirstName] = useState(estimate?.first_name ?? '')
  const [lastName, setLastName] = useState(estimate?.last_name ?? '')
  const [companyName, setCompanyName] = useState(estimate?.company_name ?? '')
  const [estimateName, setEstimateName] = useState(estimate?.estimate_name ?? '')
  const [phone, setPhone] = useState(estimate?.phone ?? '')
  const [email, setEmail] = useState(estimate?.email ?? '')
  // Structured address fields
  const [addressLine, setAddressLine] = useState(estimate?.address_line ?? '')
  const [city, setCity] = useState(estimate?.city ?? '')
  const [addrState, setAddrState] = useState(estimate?.state ?? '')
  const [zip, setZip] = useState(estimate?.zip ?? '')
  // Legacy client_name is now computed from firstName + lastName
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
    if (!firstName.trim() || !lastName.trim()) return

    if (isRegenerate && !showRegenerateConfirm) {
      setShowRegenerateConfirm(true)
      return
    }

    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    onGenerate({
      client_name: fullName,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      company_name: companyName.trim() || null,
      estimate_name: estimateName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address_line: addressLine.trim(),
      city: city.trim(),
      state: addrState.trim(),
      zip: zip.trim(),
      project_address: [addressLine.trim(), city.trim(), [addrState.trim(), zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      project_description: projectDescription.trim(),
      files: uploadedFiles.map((f) => f.file),
    })
    setShowRegenerateConfirm(false)
  }

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0

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

        {/* Estimate Name */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Estimate Name</label>
          <input
            type="text"
            value={estimateName}
            onChange={(e) => setEstimateName(e.target.value)}
            placeholder="e.g. Johnson Patio & Walkway"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* First Name / Last Name */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g. John"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="e.g. Johnson"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
        </div>

        {/* Company Name */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Company Name (If Applicable)</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Johnson Properties LLC"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* Phone / Email */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. (508) 555-1234"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. john@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
        </div>

        {/* Address */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Address</label>
          <input
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="e.g. 123 Main St"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* City / State / Zip */}
        <div className="mb-5 grid grid-cols-[2fr_1fr_1fr] gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Austin"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">State</label>
            <input
              type="text"
              value={addrState}
              onChange={(e) => setAddrState(e.target.value)}
              placeholder="e.g. TX"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Zip</label>
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="e.g. 78701"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </div>
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
              {uploadedFiles.map((f, idx) => {
                const isPdf = f.file.type === 'application/pdf'
                const isImage = f.file.type.startsWith('image/')
                const handleMeasure = isImage && f.preview
                  ? () => setMeasureImageUrl(f.preview!)
                  : isPdf
                  ? async () => {
                      try {
                        const dataUrl = await rasterizePdfPage1(f.file)
                        setMeasureImageUrl(dataUrl)
                      } catch {
                        // Silently fail — measure tool won't open
                      }
                    }
                  : undefined
                return (
                  <FilePreview
                    key={`${f.file.name}-${idx}`}
                    file={f}
                    onRemove={() => removeFile(idx)}
                    onMeasure={handleMeasure}
                  />
                )
              })}
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
            disabled={!canSubmit || generating}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Jamie is on it...
              </>
            ) : isRegenerate ? (
              <>
                <RefreshCw size={16} />
                Regenerate Work Areas
              </>
            ) : (
              <>
                Generate Work Areas
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
                    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
                    onGenerate({
                      client_name: fullName,
                      first_name: firstName.trim(),
                      last_name: lastName.trim(),
                      company_name: companyName.trim() || null,
                      estimate_name: estimateName.trim() || null,
                      phone: phone.trim() || null,
                      email: email.trim() || null,
                      address_line: addressLine.trim(),
                      city: city.trim(),
                      state: addrState.trim(),
                      zip: zip.trim(),
                      project_address: [addressLine.trim(), city.trim(), [addrState.trim(), zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', '),
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
