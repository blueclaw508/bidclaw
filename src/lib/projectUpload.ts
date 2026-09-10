import { Upload } from 'tus-js-client'
import { supabase } from './supabase'
import { mediaMime } from '../../supabase/functions/_shared/mediaPolicy.ts'

export async function uploadProjectFile(file: File, path: string, progress: (percent: number) => void) {
  const {data:{session}} = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in again before uploading.')
  const base = new URL(import.meta.env.VITE_SUPABASE_URL)
  if (base.hostname.endsWith('.supabase.co')) base.hostname = base.hostname.replace('.supabase.co','.storage.supabase.co')
  await new Promise<void>((resolve,reject) => {
    const upload = new Upload(file, {
      endpoint: `${base.origin}/storage/v1/upload/resumable`,
      headers: {authorization:`Bearer ${session.access_token}`},
      retryDelays: [0,1000,3000,5000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {bucketName:'project-files',objectName:path,contentType:mediaMime(file.type,file.name)||file.type||'application/octet-stream',cacheControl:'3600'},
      onProgress: (sent,total)=>progress(Math.round(sent/total*100)),
      onError: reject,
      onSuccess: ()=>resolve(),
    })
    upload.start()
  })
}
