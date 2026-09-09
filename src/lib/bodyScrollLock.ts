const locks = new Map<HTMLElement, { count: number; overflow: string }>()

/** Overlapping dialogs share one lock; the last close restores the original style. */
export function lockBodyScroll(body: HTMLElement = document.body): () => void {
  const state = locks.get(body) ?? { count: 0, overflow: body.style.overflow }
  state.count++
  locks.set(body, state)
  body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    state.count--
    if (state.count === 0) {
      body.style.overflow = state.overflow
      locks.delete(body)
    }
  }
}
