import { useEffect, useState } from 'react'
import { uploadProjectFile } from '@/lib/projectUpload'
import { mediaMime, needsMediaReview, VIDEO_LIMIT } from '../../../supabase/functions/_shared/mediaPolicy.ts'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import type { ProjectFile, ProjectFileType } from '@/lib/types'

export const FILE_TYPE_ORDER: ProjectFileType[] = [
  'photo',
  'video',
  'original_plan',
  'measured_plan',
  'crew_budget',
  'customer_proposal',
  'signed_proposal',
  'invoice',
  'change_order',
  'other',
]

export const FILE_TYPE_LABEL: Record<ProjectFileType, string> = {
  photo: 'Photos',
  video: 'Videos',
  original_plan: 'Original Plan',
  measured_plan: 'Measured Plan',
  crew_budget: 'Crew Budget',
  customer_proposal: 'Customer Proposal',
  signed_proposal: 'Signed Proposal',
  invoice: 'Invoice',
  change_order: 'Change Order',
  other: 'Other',
}

interface UploadFilesModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** 0 for an empty project (defaults to Original Plan), >0 defaults to Other */
  existingFileCount: number
  /** The files react-dropzone accepted for this drop */
  files: File[]
  /** Called after upload (success or partial), so parent refreshes list + totals */
  onUploaded?: (newRows: ProjectFile[]) => void
}

export function UploadFilesModal({
  open,
  onClose,
  projectId,
  existingFileCount,
  files,
  onUploaded,
}: UploadFilesModalProps) {
  const { user } = useAuth()

  // Default categorization: first upload to an empty project → Original Plan,
  // every subsequent batch → Other. Per spec.
  const defaultFileType: ProjectFileType =
    existingFileCount === 0 ? 'original_plan' : 'other'
  const [fileType, setFileType] = useState<ProjectFileType>(defaultFileType)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<Record<string,number>>({})

  // Re-sync default when the modal opens with a new batch
  useEffect(() => {
    if (open) {
      setFileType(files.every(f=>mediaMime(f.type,f.name).startsWith('video/'))?'video':files.every(f=>mediaMime(f.type,f.name).startsWith('image/'))?'photo':existingFileCount === 0 ? 'original_plan' : 'other')
      setProgress({})
      setSubmitting(false)
    }
  }, [open, existingFileCount, files])

  const handleUpload = async () => {
    if (!user || files.length === 0) return
    setSubmitting(true)

    // Per-file upload in parallel. Each file is independent — one failure
    // does not abort the others. We collect successes + failures and toast
    // both at the end.
    const results = await Promise.all(
      files.map(async (file) => {
        const safeName = sanitizeFilename(file.name)
        const storagePath = `${user.id}/${projectId}/${Date.now()}_${safeName}`
        try {
          await uploadProjectFile(file,storagePath,percent=>setProgress(p=>({...p,[file.name]:percent})))
        } catch(error) {
          return {file,ok:false as const,error:error instanceof Error?error.message:'Upload failed.'}
        }
        // Insert DB row pointing at the just-uploaded storage object
        const insert = await supabase
          .from('project_files')
          .insert({
            project_id: projectId,
            file_type: mediaMime(file.type,file.name).startsWith('video/')?'video':mediaMime(file.type,file.name).startsWith('image/')?'photo':fileType,
            file_name: file.name, // preserve original (display)
            storage_path: storagePath,
            mime_type: mediaMime(file.type,file.name) || file.type || null,
            file_size_bytes: file.size,
            version_number: 1,
          })
          .select()
          .single()
        if (insert.error || !insert.data) {
          // Best-effort rollback: try to remove the orphan storage object
          await supabase.storage.from('project-files').remove([storagePath])
          return {
            file,
            ok: false as const,
            error: insert.error?.message ?? 'DB insert returned no row',
          }
        }
        return { file, ok: true as const, row: insert.data as ProjectFile }
      })
    )

    setSubmitting(false)

    const successes = results.filter((r) => r.ok)
    const failures = results.filter((r) => !r.ok)
    if (successes.length > 0) {
      toast.success(
        successes.length === 1
          ? 'File uploaded.'
          : `${successes.length} files uploaded.`
      )
      onUploaded?.(successes.map((r) => (r as { row: ProjectFile }).row))
    }
    for (const f of failures) {
      toast.error(`${f.file.name}: ${(f as { error: string }).error}`)
    }
    onClose()
  }

  if (!user) return null

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={
        files.length === 1
          ? 'Upload file'
          : `Upload ${files.length} files`
      }
      description="Photos and videos are categorized automatically. Choose a category for other documents; you can change it later."
      size="lg"
    >
      <div className="space-y-5">
        {/* File list preview */}
        <ul className="max-h-48 overflow-y-auto rounded-md border border-brand-border bg-brand-surface p-3">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 py-1 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-brand-text-muted" />
              <span className="min-w-0 flex-1 truncate text-brand-text">{f.name}</span>
              <span className="shrink-0 text-xs text-brand-text-muted">{submitting ? `${progress[f.name]??0}% · ` : ''}{formatFileSize(f.size)}</span>
            </li>
          ))}
        </ul>

        {/* File type picker */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
            File category
          </span>
          <select
            value={fileType}
            onChange={(e) => setFileType(e.target.value as ProjectFileType)}
            className={inputClasses}
            disabled={submitting}
          >
            {FILE_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {FILE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={submitting || files.length === 0}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50',
              submitting && 'cursor-wait'
            )}
          >
            {submitting ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Uploading…
              </>
            ) : (
              <>
                Upload {files.length > 1 ? `${files.length} files` : 'file'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- helpers ---------- */

const inputClasses =
  'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 disabled:bg-brand-surface'

/**
 * Storage path-safe filename. Strips non-alphanumeric except `.`, `-`, `_`,
 * collapses runs of underscores, preserves the extension and lowercases it.
 * Example: "My Plan (rev 2).PDF" → "my_plan_rev_2.pdf"
 */
export function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return (safe || 'file') + ext
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Allow-list of MIME types. Re-exported so FilesTab can pass to react-dropzone.
export const FILE_ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
}

export const FILE_SIZE_CAP = VIDEO_LIMIT
export function validateProjectFile(file:File) {
  const cap=needsMediaReview(file.type,file.name)?VIDEO_LIMIT:50*1024*1024
  return file.size>cap?{code:'file-too-large',message:`Maximum ${cap/1024/1024} MB for this format.`}:null
}
