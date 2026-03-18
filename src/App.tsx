import { useState } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/AppLayout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { NewEstimate } from '@/pages/NewEstimate'
import { EstimateWorkflow } from '@/pages/EstimateWorkflow'
import { Settings } from '@/pages/Settings'
import { Loader2 } from 'lucide-react'

type Page = 'dashboard' | 'new-estimate' | 'settings'

function AppContent() {
  const { user, hasQCAccount, loading } = useAuth()
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)

  // Loading
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <Login />
  }

  // No QuickCalc account
  if (!hasQCAccount) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="mx-4 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg text-white font-bold"
            style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}>
            BC
          </div>
          <h2 className="mb-2 text-xl font-bold" style={{ color: '#1e3a5f' }}>
            QuickCalc Account Required
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            BidClaw requires a QuickCalc account. Visit{' '}
            <a
              href="https://bluequickcalc.app"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:text-blue-800 underline"
            >
              bluequickcalc.app
            </a>{' '}
            to get started.
          </p>
          <a
            href="https://bluequickcalc.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
            style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}
          >
            Go to QuickCalc
          </a>
        </div>
      </div>
    )
  }

  // Active estimate workflow
  if (activeEstimateId) {
    return (
      <AppLayout
        currentPage={currentPage}
        onNavigate={(page) => {
          setActiveEstimateId(null)
          setCurrentPage(page)
        }}
      >
        <EstimateWorkflow
          estimateId={activeEstimateId}
          onBack={() => {
            setActiveEstimateId(null)
            setCurrentPage('dashboard')
          }}
        />
      </AppLayout>
    )
  }

  // Main app
  return (
    <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'dashboard' && (
        <Dashboard
          onNewEstimate={() => setCurrentPage('new-estimate')}
          onOpenEstimate={(id) => setActiveEstimateId(id)}
        />
      )}
      {currentPage === 'new-estimate' && (
        <NewEstimate
          onCreated={(id) => setActiveEstimateId(id)}
          onCancel={() => setCurrentPage('dashboard')}
        />
      )}
      {currentPage === 'settings' && <Settings />}
    </AppLayout>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  )
}
