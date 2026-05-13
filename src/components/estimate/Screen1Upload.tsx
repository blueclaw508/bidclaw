// ============================================================
// v3 Screen 1 — Upload
// Minimal friction: drop plans, optional context, send to Jamie.
// NO customer info fields — those live on Screen 3.
// ============================================================

import { useState, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
import { ProgressIndicator } from './Step1ProjectInfo'
import {
  Upload,
  X,
  FileText,
  Image,
  Plus,
  ArrowRight,
  Loader2,
} from 'lucide-react'

interface UploadedFile {
  file: File
  preview: string | null
  pageCount: number
  uploading: boolean
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
]

export interface Screen1Fields {
  estimateName: string
  firstName: string
  lastName: string
  address: string
  city: string
  state: string
  zip: string
}

interface Screen1UploadProps {
  onSendToJamie: (files: File[], userContext: string, fields: Screen1Fields) => Promise<void>
  pass1Loading: boolean
  existingPlans?: { file_name: string; page_count: number }[]
  initialFields?: Screen1Fields
  onBack: () => void
}

export function Screen1Upload({
  onSendToJamie,
  pass1Loading,
  existingPlans,
  initialFields,
  onBack,
}: Screen1UploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [userContext, setUserContext] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Quick-entry fields
  const [estimateName, setEstimateName] = useState(initialFields?.estimateName ?? '')
  const [firstName, setFirstName] = useState(initialFields?.firstName ?? '')
  const [lastName, setLastName] = useState(initialFields?.lastName ?? '')
  const [address, setAddress] = useState(initialFields?.address ?? '')
  const [city, setCity] = useState(initialFields?.city ?? '')
  const [state, setState] = useState(initialFields?.state ?? '')
  const [zip, setZip] = useState(initialFields?.zip ?? '')

  const hasPlans = files.length > 0 || (existingPlans?.length ?? 0) > 0

  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    const validFiles = Array.from(newFiles).filter(f => ACCEPTED_TYPES.includes(f.type))
    if (validFiles.length === 0) return

    const uploads: UploadedFile[] = []
    for (const file of validFiles) {
      let pageCount = 1
      let preview: string | null = null

      if (file.type === 'application/pdf') {
        try {
          const buf = await file.arrayBuffer()
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise
          pageCount = pdf.numPages
          pdf.destroy()
        } catch { /* default 1 page */ }
      } else if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file)
      }

      uploads.push({ file, preview, pageCount, uploading: false })
    }

    setFiles(prev => [...prev, ...uploads])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleRemove = (idx: number) => {
    setFiles(prev => {
      const removed = prev[idx]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const handleSend = async () => {
    if (!hasPlans) return
    await onSendToJamie(files.map(f => f.file), userContext.trim(), {
      estimateName: estimateName.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ProgressIndicator currentStep={1} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Header */}
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-blue-900">Upload Your Plans</h2>
          <p className="text-sm text-slate-500 mt-1">
            Drop your plan sheets and Jamie will read them.
          </p>
        </div>

        {/* Quick-entry fields */}
        <div className="mb-4 space-y-2">
          <input
            type="text"
            value={estimateName}
            onChange={(e) => setEstimateName(e.target.value)}
            placeholder="Estimate name"
            disabled={pass1Loading}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              disabled={pass1Loading}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              disabled={pass1Loading}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
            />
          </div>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address"
            disabled={pass1Loading}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              disabled={pass1Loading}
              className="flex-[2] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
            />
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="State"
              disabled={pass1Loading}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
            />
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="Zip"
              disabled={pass1Loading}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-60 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`relative mb-4 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-[#2563EB] bg-blue-50'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
          } ${pass1Loading ? 'pointer-events-none opacity-60' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={32} className={`mx-auto mb-3 ${dragOver ? 'text-[#2563EB]' : 'text-slate-300'}`} />
          <p className="text-sm font-medium text-slate-600">
            Drag plans here or click to browse
          </p>
          <p className="text-xs text-slate-400 mt-1">
            PDF, PNG, JPG — multiple files OK
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mb-4 space-y-2">
            {files.map((uf, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
                {uf.file.type === 'application/pdf' ? (
                  <FileText size={18} className="flex-shrink-0 text-red-500" />
                ) : (
                  <Image size={18} className="flex-shrink-0 text-blue-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{uf.file.name}</p>
                  <p className="text-xs text-slate-400">
                    {uf.file.type === 'application/pdf'
                      ? `${uf.pageCount} page${uf.pageCount > 1 ? 's' : ''}`
                      : 'Image'}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(idx) }}
                  disabled={pass1Loading}
                  className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"
                >
                  <X size={16} />
                </button>
              </div>
            ))}

            {/* Add more */}
            <button
              onClick={() => inputRef.current?.click()}
              disabled={pass1Loading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:text-blue-700 transition-colors disabled:opacity-50"
            >
              <Plus size={14} />
              Add more plans
            </button>
          </div>
        )}

        {/* Existing plans (if navigating back) */}
        {(existingPlans?.length ?? 0) > 0 && files.length === 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Previously uploaded</p>
            {existingPlans!.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50/50 px-4 py-2.5">
                <FileText size={18} className="flex-shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{p.file_name}</p>
                  <p className="text-xs text-slate-400">{p.page_count} page{p.page_count > 1 ? 's' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Context textarea */}
        <div className="mb-6">
          <textarea
            value={userContext}
            onChange={(e) => setUserContext(e.target.value)}
            placeholder="Tell Jamie about the job (optional)
e.g., Just the patio and steps, or price the full site plan"
            rows={3}
            disabled={pass1Loading}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-none disabled:opacity-60 placeholder:text-slate-400"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            disabled={pass1Loading}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            Back to Estimates
          </button>

          <button
            onClick={handleSend}
            disabled={!hasPlans || pass1Loading}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pass1Loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Jamie is studying the plans...
              </>
            ) : (
              <>
                Send to Jamie
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
