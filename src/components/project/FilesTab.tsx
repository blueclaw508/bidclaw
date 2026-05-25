import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone, type FileRejection } from 'react-dropzone'
import {
  Download,
  FileText,
  FolderUp,
  Ruler,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  FILE_ACCEPT,
  FILE_SIZE_CAP,
  FILE_TYPE_LABEL,
  FILE_TYPE_ORDER,
  UploadFilesModal,
  formatFileSize,
} from '@/components/project/UploadFilesModal'
import { cn } from '@/lib/utils'
import type { ProjectFile, ProjectFileType } from '@/lib/types'

interface FilesTabProps {
  projectId: string
  /** Called after CRUD so parent (ProjectDetail) refreshes totals card. */
  onChange?: () => void
}

export default function FilesTab({ projectId, onChange }: FilesTabProps) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Pending upload batch (set by dropzone, consumed by modal)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  // Delete confirmation target
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false })
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    setRows((data ?? []) as ProjectFile[])
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  // ── react-dropzone wiring ──
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      // Surface rejections immediately so the user sees per-file reasons.
      for (const rej of fileRejections) {
        const reasons = rej.errors.map((e) => friendlyRejectionReason(e.code)).join('; ')
        toast.error(`${rej.file.name}: ${reasons}`)
      }
      if (acceptedFiles.length === 0) return
      setPendingFiles(acceptedFiles)
      setUploadModalOpen(true)
    },
    []
  )

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } =
    useDropzone({
      onDrop,
      accept: FILE_ACCEPT,
      maxSize: FILE_SIZE_CAP,
      noClick: true, // we render our own browse button
    })

  // Inline file_type change on a row (no modal — patch + reload)
  const patchFileType = async (id: string, next: ProjectFileType) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, file_type: next } : r)))
    const { error } = await supabase
      .from('project_files')
      .update({ file_type: next })
      .eq('id', id)
    if (error) {
      toast.error(`Recategorize failed: ${error.message}`)
      void load()
    }
  }

  const handleOpen = async (file: ProjectFile) => {
    const { data, error } = await supabase.storage
      .from('project-files')
      .createSignedUrl(file.storage_path, 60)
    if (error || !data?.signedUrl) {
      toast.error(`Couldn't open file: ${error?.message ?? 'no URL returned'}`)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  // Delete order per spec: storage first, then DB. On storage failure → return
  // with toast. On DB failure → DB row is orphaned and surfaced for retry.
  const handleDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    const { error: storageErr } = await supabase.storage
      .from('project-files')
      .remove([target.storage_path])
    if (storageErr) {
      toast.error(`Storage delete failed: ${storageErr.message}`)
      return
    }
    const { error: dbErr } = await supabase
      .from('project_files')
      .delete()
      .eq('id', target.id)
    if (dbErr) {
      toast.error(
        `Storage object deleted but DB row remains (orphan). Retry: ${dbErr.message}`
      )
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== target.id))
    setDeleteTarget(null)
    toast.success('File deleted.')
    onChange?.()
  }

  // Group rows by file_type for display
  const grouped = useMemo(() => {
    const m: Partial<Record<ProjectFileType, ProjectFile[]>> = {}
    for (const r of rows) {
      ;(m[r.file_type] ??= []).push(r)
    }
    return m
  }, [rows])

  return (
    <div className="space-y-4">
      {/* Slate pastel section header — matches QC project-detail section card. */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
              <FolderUp className="h-4 w-4 text-slate-700" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Files
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Plans, proposals, invoices, change orders. Stored privately,
                viewed via short-lived signed URLs.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openFileDialog}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy-dark"
          >
            <FolderUp className="h-4 w-4" />
            Browse files
          </button>
        </div>
      </section>

      {/* Drop zone (always present; users can drop OR use Browse button) */}
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white px-6 py-10 text-center transition-colors',
          isDragActive
            ? 'border-brand-navy bg-brand-navy/5'
            : 'border-gray-300 hover:border-brand-navy/40'
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud
          className={cn(
            'h-8 w-8',
            isDragActive ? 'text-brand-navy' : 'text-gray-400'
          )}
        />
        <p className="mt-3 text-sm font-semibold text-gray-900">
          {isDragActive ? 'Drop files here…' : 'Drag and drop files here'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, images, Word, Excel, CSV. Up to 50 MB each. Click <strong>Browse files</strong> for the picker.
        </p>
      </div>

      {/* Status / list */}
      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Couldn't load files: {loadError}{' '}
          <button onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {!loadError && loading && rows.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading files…
        </div>
      )}

      {!loadError && !loading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          No files uploaded yet. Drag-drop above or click Browse files.
        </div>
      )}

      {!loadError && rows.length > 0 && (
        <div className="space-y-5">
          {FILE_TYPE_ORDER.map((type) => {
            const inGroup = grouped[type]
            if (!inGroup || inGroup.length === 0) return null
            return (
              <section key={type}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  {FILE_TYPE_LABEL[type]}{' '}
                  <span className="ml-1 text-gray-400">({inGroup.length})</span>
                </h3>
                <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  {inGroup.map((file, idx) => (
                    <li
                      key={file.id}
                      className={cn(
                        idx < inGroup.length - 1 && 'border-b border-gray-100',
                        'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4'
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => void handleOpen(file)}
                          className="block truncate text-left text-sm font-semibold text-gray-900 hover:text-brand-navy hover:underline"
                          title={file.file_name}
                        >
                          {file.file_name}
                        </button>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {formatFileSize(file.file_size_bytes ?? 0)} ·
                          uploaded {formatUploadDate(file.uploaded_at)}
                          {file.version_number > 1 && ` · v${file.version_number}`}
                        </div>
                      </div>
                      <select
                        value={file.file_type}
                        onChange={(e) =>
                          void patchFileType(file.id, e.target.value as ProjectFileType)
                        }
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 sm:w-44"
                        title="Recategorize"
                      >
                        {FILE_TYPE_ORDER.map((t) => (
                          <option key={t} value={t}>
                            {FILE_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        {file.mime_type === 'application/pdf' && (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/app/projects/${projectId}/measure/${file.id}`
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand-navy"
                            title="Open measure tool"
                          >
                            <Ruler className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleOpen(file)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand-navy"
                          title="Open in new tab (signed URL, 60s)"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(file)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-rose-50 hover:text-rose-700"
                          title="Delete file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {/* Upload modal — appears after a drop / browse selection */}
      <UploadFilesModal
        open={uploadModalOpen}
        onClose={() => {
          setUploadModalOpen(false)
          setPendingFiles([])
        }}
        projectId={projectId}
        existingFileCount={rows.length}
        files={pendingFiles}
        onUploaded={() => {
          void load()
          onChange?.()
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this file?"
        description={
          deleteTarget ? (
            <>
              <strong className="text-brand-text">{deleteTarget.file_name}</strong>{' '}
              will be permanently removed from storage and your project.
              This cannot be undone.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}

/* ---------- helpers ---------- */

function friendlyRejectionReason(code: string): string {
  switch (code) {
    case 'file-too-large':
      return 'too large (max 50 MB)'
    case 'file-invalid-type':
      return 'not an allowed file type (PDF, image, Word, Excel, CSV)'
    case 'too-many-files':
      return 'too many files at once'
    default:
      return code
  }
}

function formatUploadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
