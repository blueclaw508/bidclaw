import { useEffect, useRef, useState } from 'react'
import { FileText, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ProjectFile } from '@/lib/types'

/** Only request private media when its row comes into view. Never autoplay. */
export function FileThumbnail({file, onOpen}: {file: ProjectFile; onOpen: () => void}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const video = file.mime_type?.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.file_name)
  const image = file.mime_type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(file.file_name)
  useEffect(() => {
    setUrl(null); setFailed(false)
    if (!image && !video) return
    let alive = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      observer.disconnect()
      void supabase.storage.from('project-files').createSignedUrl(file.storage_path, 3600).then(({data, error}) => {
        if (!alive) return
        if (error || !data) setFailed(true)
        else setUrl(data.signedUrl)
      }).catch(() => { if (alive) setFailed(true) })
    }, {rootMargin: '200px'})
    if (ref.current) observer.observe(ref.current)
    return () => { alive = false; observer.disconnect() }
  }, [file.storage_path, image, video])
  return <button ref={ref} type="button" onClick={onOpen} aria-label={`Open ${file.file_name}`} title={failed ? 'Preview unavailable; click to open file' : file.file_name} className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-gray-50">
    {url && !failed ? video ? <><video src={url+'#t=0.1'} preload="metadata" muted playsInline onError={() => setFailed(true)} className="h-full w-full object-cover" /><Play className="pointer-events-none absolute h-6 w-6 rounded-full bg-black/60 p-1 text-white" /></> : <img src={url} alt={file.file_name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : <FileText className="h-5 w-5 text-gray-400" />}
  </button>
}
