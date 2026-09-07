import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App'
import { reloadOnceForStaleChunk } from '@/lib/staleChunk'

// A deploy replaces every hashed chunk. A tab opened before the deploy still
// holds the old index.html, and the first lazy page it visits asks for a
// chunk that no longer exists on the CDN. Vite surfaces that as
// vite:preloadError; the only fix is a reload, so do it here, once, before
// the error boundary ever sees it.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster position="top-right" richColors closeButton />
  </StrictMode>,
)
