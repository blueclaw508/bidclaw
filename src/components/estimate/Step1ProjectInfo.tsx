import { useState, useRef, useCallback, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
import type { V2Estimate, V2PlanFile, EstimateRecord } from '@/lib/types'
import { supabase } from '@/lib/supabase'
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
  Ruler,
  Loader2,
} from 'lucide-react'

// ── V2 Props ──
// Step1 now saves V2 fields directly to the estimates table.
// onContinue fires AFTER Pass 1 completes (or after save if no plans).
// The parent still controls step transitions.

interface Step1ProjectInfoProps {
  estimate: V2Estimate | EstimateRecord | null
  estimateId?: string
  onContinue?: () => void
  onBack?: () => void
  onPass1Start?: () => void
  onPass1Complete?: () => void
  onPass1Error?: (error: string) => void

  // Legacy compat — old parent may pass these
  onGenerate?: (data: {
    client_name: string
    project_name: string | null
    project_address: string
    project_description: string
    files: File[]
  }) => void
  generating?: boolean
  onFieldChange?: (updates: Record<string, unknown>) => void
}

interface UploadedFile {
  file: File
  preview: string | null
  pageCount?: number
  planRef?: V2PlanFile  // V2: reference stored in plans JSONB
  uploading?: boolean
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
]

// V2 safe columns for autosave
// V2 save fields reference (used by saveToDb below)
// first_name, last_name, company_name, phone, email,
// estimate_name, address_line, city, state, zip,
// project_type, project_description

function ProgressIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: "Jamie's Findings" },
    { num: 3, label: 'Review' },
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
          {file.uploading ? ' \u00B7 Uploading...' : ''}
        </p>
      </div>
      {canMeasure && (
        <button
          onClick={onMeasure}
          className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg bg-[#1e40af] px-5 py-2.5 text-base font-bold text-white hover:bg-[#2563EB] hover:brightness-110 active:scale-95 transition-all duration-100 shadow-md cursor-pointer"
          title="Open measurement tool"
        >
          <Ruler size={22} />
          Measure from Plan
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
  estimate, onContinue, onBack, onPass1Start, onPass1Complete, onPass1Error,
  onGenerate, generating, onFieldChange,
}: Step1ProjectInfoProps) {
  // ── V2: Read fields directly — safe for both V2Estimate and legacy EstimateRecord ──
  // Use `est` for safe field access across both types; `estV2` for V2-specific operations
  const est = estimate as Record<string, unknown> | null
  const estV2 = estimate as V2Estimate | null
  const [firstName, setFirstName] = useState((est?.first_name as string) ?? '')
  const [lastName, setLastName] = useState((est?.last_name as string) ?? '')
  const [companyName, setCompanyName] = useState((est?.company_name as string) ?? '')
  const [estimateName, setEstimateName] = useState((est?.estimate_name as string) ?? (est?.project_name as string) ?? '')
  const [phone, setPhone] = useState((est?.phone as string) ?? '')
  const [email, setEmail] = useState((est?.email as string) ?? '')
  const [addressLine, setAddressLine] = useState((est?.address_line as string) ?? '')
  const [city, setCity] = useState((est?.city as string) ?? '')
  const [addrState, setAddrState] = useState((est?.state as string) ?? '')
  const [zip, setZip] = useState((est?.zip as string) ?? '')
  const [projectType, setProjectType] = useState((est?.project_type as string) ?? '')
  const [projectDescription, setProjectDescription] = useState((est?.project_description as string) ?? '')

  // File state — initialize from existing plans in DB
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [pass1Running, setPass1Running] = useState(false)
  const [pass1ErrorMsg, setPass1ErrorMsg] = useState<string | null>(null)

  // Measurement tool state (preserved from v1)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [measureScale, setMeasureScale] = useState<import('./PlanMeasure').ScaleCalibration | null>(null)
  const [measureImageUrl, setMeasureImageUrl] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── V2: Save directly to estimates table using V2 columns ──
  const saveToDb = useCallback(async () => {
    if (!estV2?.id) return

    const updates: Record<string, unknown> = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      company_name: companyName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      estimate_name: estimateName.trim() || null,
      address_line: addressLine.trim(),
      city: city.trim(),
      state: addrState.trim(),
      zip: zip.trim(),
      project_type: projectType.trim() || null,
      project_description: projectDescription.trim() || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('estimates')
      .update(updates)
      .eq('id', estV2!.id)

    if (error) {
      console.error('[Step1V2] Save failed:', error.message)
    }

    if (onFieldChange) onFieldChange(updates)
  }, [estV2?.id, firstName, lastName, companyName, estimateName, phone, email, addressLine, city, addrState, zip, projectType, projectDescription, onFieldChange])

  // Autosave — 1 second after every field change
  useEffect(() => {
    if (!estV2?.id) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => saveToDb(), 1000)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, companyName, estimateName, phone, email, addressLine, city, addrState, zip, projectType, projectDescription])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [])

  // ── V2: File upload → Supabase storage → plans JSONB ──
  const uploadFileToStorage = useCallback(async (file: File): Promise<V2PlanFile | null> => {
    if (!estV2?.id) return null

    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user?.id
    if (!userId) return null

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const storagePath = `plans/${userId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('plans')
      .upload(storagePath, file)

    if (uploadError) {
      console.error('[Step1V2] Upload failed:', uploadError.message)
      return null
    }

    const { data: urlData } = supabase.storage.from('plans').getPublicUrl(storagePath)

    // Count PDF pages
    let pageCount = 1
    if (ext === 'pdf') {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        pageCount = pdf.numPages
        pdf.destroy()
      } catch { /* default to 1 */ }
    }

    return {
      file_path: urlData.publicUrl,
      file_name: file.name,
      page_count: pageCount,
      rasterized_pages: [],
      uploaded_at: new Date().toISOString(),
    }
  }, [estV2?.id])

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => ACCEPTED_TYPES.includes(f.type))

    // Add files to UI immediately (with uploading flag)
    const newUploadedFiles: UploadedFile[] = fileArray.map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      uploading: true,
    }))
    setUploadedFiles(prev => [...prev, ...newUploadedFiles])

    // Upload each to Supabase storage in parallel
    const planRefs: V2PlanFile[] = []
    const results = await Promise.all(
      fileArray.map(file => uploadFileToStorage(file))
    )

    // Update files with plan refs and remove uploading flag
    setUploadedFiles(prev => {
      const updated = [...prev]
      let resultIdx = 0
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].uploading) {
          const ref = results[resultIdx]
          updated[i] = { ...updated[i], uploading: false, planRef: ref ?? undefined }
          // Get page count from PDF
          if (ref) {
            updated[i].pageCount = ref.page_count
            planRefs.push(ref)
          }
          resultIdx++
          if (resultIdx >= results.length) break
        }
      }
      return updated
    })

    // Save plans JSONB to estimates table
    if (planRefs.length > 0 && estV2?.id) {
      const currentPlans: V2PlanFile[] = estV2?.plans ?? []
      const allPlans = [...currentPlans, ...planRefs]
      await supabase
        .from('estimates')
        .update({ plans: allPlans, updated_at: new Date().toISOString() })
        .eq('id', estV2!.id)
    }
  }, [estV2?.id, estV2?.plans, uploadFileToStorage])

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

  const removeFile = useCallback(async (index: number) => {
    setUploadedFiles(prev => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })

    // Remove from plans JSONB in DB
    if (estV2?.id && estV2?.plans) {
      const updatedPlans = estV2?.plans.filter((_, i) => i !== index)
      await supabase
        .from('estimates')
        .update({ plans: updatedPlans, updated_at: new Date().toISOString() })
        .eq('id', estV2!.id)
    }
  }, [estV2?.id, estV2?.plans])

  // ── V2: Continue button → save → run Pass 1 → transition ──
  const handleContinue = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim() || !addressLine.trim() || !city.trim()) return

    // Save fields immediately
    await saveToDb()

    // If we have plans, run Pass 1
    const hasPlans = (estV2?.plans?.length ?? 0) > 0 || uploadedFiles.some(f => f.planRef)
    if (hasPlans) {
      setPass1Running(true)
      setPass1ErrorMsg(null)
      onPass1Start?.()

      try {
        const { runPass1V2 } = await import('@/lib/pass1V2')

        const plans = estV2?.plans ?? uploadedFiles
          .filter(f => f.planRef)
          .map(f => f.planRef!)

        const result = await runPass1V2({
          estimateName: estimateName.trim() || null,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          addressLine: addressLine.trim(),
          city: city.trim(),
          state: addrState.trim(),
          zip: zip.trim(),
          projectType: projectType.trim() || null,
          projectDescription: projectDescription.trim() || null,
          plans: plans.map(p => ({ file_path: p.file_path, file_name: p.file_name })),
        })

        // Store Pass 1 results
        await supabase
          .from('estimates')
          .update({
            pass1_extraction: result.extraction,
            pass1_confidence: result.confidence,
            pass1_completed_at: new Date().toISOString(),
            status: 'pass1_complete',
            updated_at: new Date().toISOString(),
          })
          .eq('id', estimate!.id)

        setPass1Running(false)
        onPass1Complete?.()
        onContinue?.()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Jamie could not read the plans'
        setPass1Running(false)
        setPass1ErrorMsg(msg)
        onPass1Error?.(msg)
      }
    } else {
      // No plans — skip Pass 1, go directly to Step 2
      onContinue?.()
    }
  }, [firstName, lastName, addressLine, city, addrState, zip, estimateName, projectType, projectDescription, estimate, uploadedFiles, saveToDb, onContinue, onPass1Start, onPass1Complete, onPass1Error])

  // Legacy compat: if parent passes onGenerate, wire through
  const handleSubmit = () => {
    if (onGenerate) {
      // Legacy path
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
      const companyStr = companyName.trim()
      const clientName = companyStr ? `${fullName} — ${companyStr}` : fullName
      onGenerate({
        client_name: clientName,
        project_name: estimateName.trim() || null,
        project_address: [addressLine.trim(), city.trim(), [addrState.trim(), zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        project_description: projectDescription.trim(),
        files: uploadedFiles.map(f => f.file),
      })
    } else {
      handleContinue()
    }
  }

  const isPass1OrGenerating = pass1Running || generating
  const canSubmit = firstName.trim().length > 0
    && lastName.trim().length > 0
    && addressLine.trim().length > 0
    && city.trim().length > 0

  return (
    <div className="mx-auto max-w-3xl">
      <ProgressIndicator currentStep={1} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-blue-900">Project Information</h2>
        </div>

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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Company name (if applicable)</label>
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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Address <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="e.g. 123 Main St"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>

        {/* City / State / Zip */}
        <div className="mb-4 grid grid-cols-[2fr_1fr_1fr] gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              City <span className="text-red-500">*</span>
            </label>
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

        {/* V2: Project Type — free text, not dropdown */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Project type</label>
          <input
            type="text"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            placeholder="e.g., Landscape renovation, Pool patio, Driveway"
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
            Plans & Photos
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

        {/* Pass 1 error message */}
        {pass1ErrorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              Jamie hit a snag — {pass1ErrorMsg}. Try again or adjust your scope.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          {onBack ? (
            <button
              onClick={async () => {
                await saveToDb()
                onBack?.()
              }}
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
            disabled={!canSubmit || isPass1OrGenerating}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-100 hover:brightness-110 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPass1OrGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Jamie is studying the plans...
              </>
            ) : (
              <>
                Continue
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>

        {/* Regenerate confirmation dialog — preserved from v1 */}
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
                    setShowRegenerateConfirm(false)
                    handleContinue()
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
          scale={measureScale}
          onMeasurementsChange={(m) => { setMeasurements(m) }}
          onScaleChange={(s) => { setMeasureScale(s) }}
          onClose={() => { setMeasureImageUrl(null); saveToDb() }}
        />
      )}
    </div>
  )
}
