/**
 * Stale-chunk recovery.
 *
 * Every deploy renames the hashed JS chunks. A tab that loaded index.html
 * before the deploy keeps the old chunk names, and the first lazily loaded
 * page it visits afterwards fails to fetch its chunk. The failure reaches
 * the app two ways: Vite's `vite:preloadError` event on window, and, when
 * the import promise rejects inside React.lazy, the error boundary. Both
 * paths call this.
 *
 * A reload is the fix, and one is enough: after it the tab holds the new
 * index.html. The guard below stops a loop if the reload itself fails for
 * a different reason — a second failure inside the window falls through to
 * the error boundary and its Reload button, where a person can see it.
 */
const KEY = 'bidclaw.stale_chunk_reload_at'
const WINDOW_MS = 30_000

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch dynamically|error loading dynamically imported module/i

/** True when this error is the stale-chunk failure, not an app bug. */
export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return CHUNK_ERROR.test(msg)
}

/**
 * Reload the page unless we already did so within the last 30 seconds.
 * Returns true when a reload was started (the caller should stop what it
 * was doing), false when the guard held.
 */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* storage unavailable — reload anyway; worst case the boundary shows */
  }
  window.location.reload()
  return true
}
