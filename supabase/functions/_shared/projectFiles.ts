import Anthropic, {toFile} from 'npm:@anthropic-ai/sdk'
import {orderedConcurrentMap} from './jamiePerformance.ts'
import {mediaMime,needsMediaReview,MEDIA_EVIDENCE_RULES} from './mediaPolicy.ts'
export const FILES_BETA = 'files-api-2025-04-14'

/** What Claude can actually read, and as which content block. */
function fileKind(mime: string | null, name: string): 'document' | 'image' | null {
  const m = mediaMime(mime,name)
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'document'
  if (m === 'text/plain' || m === 'text/csv' || /\.(txt|csv|md)$/i.test(name)) return 'document'
  if (m.startsWith('image/')) return 'image'
  return null // Word/Excel/etc — the API takes no document block for them
}

const UNSUPPORTED =
  "Jamie can't read this file type yet — export it to PDF and re-upload."

export interface SyncedFile {
  id: string
  name: string
  kind: 'document' | 'image' | 'text'
  notes?: string
  fileId: string
}

/**
 * Bring the project's files up to date on the Anthropic side and return
 * everything Jamie can read. Lazy and self-healing: any file without an
 * anthropic_file_id is uploaded on the next call, and a failure is recorded
 * on the row rather than thrown, so one bad file can't block the estimate.
 */
export async function syncProjectFiles(
  // deno-lint-ignore no-explicit-any
  service: any,
  anthropic: Anthropic,
  projectId: string,
  selectedIds?: string[]
): Promise<SyncedFile[]> {
  const { data: rows } = await service
    .from('project_files')
    .select('id, file_name, mime_type, storage_path, anthropic_file_id, anthropic_sync_error, media_status, media_notes')
    .eq('project_id', projectId)
    .order('uploaded_at')
  if (!rows) throw new Error('Could not load project files. Retry before pricing.')
  const selected = selectedIds ? rows.filter((f:any)=>selectedIds.includes(f.id)) : rows
  if(selectedIds?.some(id=>!rows.some((f:any)=>f.id===id))) throw new Error('A selected file is no longer on this project. Reopen Jamie and select the files again.')
  const pending=selected.filter((f:any)=>needsMediaReview(f.mime_type,f.file_name) && !(f.media_status==='ready' && f.media_notes))
  if(pending.length) throw new Error('Prepare these files on the Files tab before Jamie continues: '+pending.map((f:any)=>f.file_name).join(', '))
  const {data:project}=await service.from('projects').select('user_id').eq('id',projectId).single()
  if(!project || selected.some((f:any)=>!String(f.storage_path).startsWith(`${project.user_id}/${projectId}/`))) throw new Error('Project file storage could not be verified.')

  const out = await orderedConcurrentMap(selected as Array<Record<string, unknown>>, 3, async (f): Promise<SyncedFile | null> => {
    const name = String(f.file_name ?? '')
    if(needsMediaReview(f.mime_type as string,name)) return {id:f.id as string,name,kind:'text',fileId:'',notes:String(f.media_notes)}
    const kind = fileKind(f.mime_type as string | null, name)
    if (!kind) {
      if (!f.anthropic_sync_error) {
        await service
          .from('project_files')
          .update({ anthropic_sync_error: UNSUPPORTED })
          .eq('id', f.id)
      }
      return null
    }
    if (f.anthropic_file_id) {
      return { id: f.id as string, name, kind, fileId: f.anthropic_file_id as string }
    }
    // Already tried and failed for a non-type reason — don't retry forever.
    if (f.anthropic_sync_error) return null

    try {
      const { data: blob, error: dlErr } = await service.storage
        .from('project-files')
        .download(f.storage_path as string)
      if (dlErr || !blob) throw new Error(dlErr?.message ?? 'could not read the stored file')
      const uploaded = await anthropic.beta.files.upload({
        file: await toFile(blob, name, {
          type: mediaMime(f.mime_type as string,name) || 'application/octet-stream',
        }),
        betas: [FILES_BETA],
      })
      await service
        .from('project_files')
        .update({
          anthropic_file_id: uploaded.id,
          anthropic_synced_at: new Date().toISOString(),
          anthropic_sync_error: null,
        })
        .eq('id', f.id)
      return { id: f.id as string, name, kind, fileId: uploaded.id }
    } catch (err) {
      await service
        .from('project_files')
        .update({
          anthropic_sync_error: err instanceof Error ? err.message : 'upload failed',
        })
        .eq('id', f.id)
    }
    return null
  })
  const failures=selected.filter((f:any,i:number)=>!out[i] && (selectedIds || mediaMime(f.mime_type,f.file_name).startsWith('image/')))
  if(failures.length) throw new Error('Jamie could not read these selected files. Check the Files tab or use JPEG/PNG photos: '+failures.map((f:any)=>f.file_name).join(', '))
  return out.filter((file): file is SyncedFile => file !== null)
}

/** Content blocks for the synced files, newest-last, cache breakpoint on
 *  the final one so the whole document prefix bills at cache rates. */
export function fileBlocks(files: SyncedFile[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = files.map((f) =>
    f.kind === 'text' ? {type:'text',text:MEDIA_EVIDENCE_RULES+'\nFile: '+f.name+'\nWalkthrough evidence:\n'+f.notes} : f.kind === 'document'
      ? ({
          type: 'document',
          source: { type: 'file', file_id: f.fileId },
          title: f.name,
        } as unknown as Anthropic.ContentBlockParam)
      : ({
          type: 'image',
          source: { type: 'file', file_id: f.fileId },
        } as unknown as Anthropic.ContentBlockParam)
  )
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1] as unknown as Record<string, unknown>
    last.cache_control = { type: 'ephemeral' }
  }
  return blocks
}

