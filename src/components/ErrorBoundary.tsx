import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { isStaleChunkError, reloadOnceForStaleChunk } from '@/lib/staleChunk'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A chunk that vanished in a deploy is not an app bug; a reload is the
    // whole fix. Everything else is logged so the next screenshot of this
    // card comes with a console line that says what happened.
    if (isStaleChunkError(error) && reloadOnceForStaleChunk()) return
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const detail = this.state.error?.message?.trim()
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <AlertCircle size={48} className="mx-auto mb-4 text-amber-500" />
            <h2 className="mb-2 text-lg font-semibold text-blue-900">Jamie hit a snag</h2>
            <p className="mb-4 text-sm text-slate-500">
              Something unexpected happened on my end — not yours. Give it a moment and reload.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}
            >
              <RefreshCw size={16} />
              Reload App
            </button>
            {detail ? (
              <p className="mt-5 break-words font-mono text-[11px] leading-snug text-slate-400">
                {detail.slice(0, 240)}
              </p>
            ) : null}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
