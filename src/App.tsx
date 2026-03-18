import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/AppLayout'
import { Login } from '@/pages/Login'
import { SetupWizard } from '@/pages/SetupWizard'
import { Dashboard } from '@/pages/Dashboard'
import { NewEstimate } from '@/pages/NewEstimate'
import { EstimateWorkflow } from '@/pages/EstimateWorkflow'
import { Settings } from '@/pages/Settings'
import { Loader2 } from 'lucide-react'

type Page = 'dashboard' | 'new-estimate' | 'settings'

function AppContent() {
  const { user, company, loading } = useAuth()
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    if (!loading && user && !company) {
      setNeedsSetup(true)
    } else if (company) {
      setNeedsSetup(false)
    }
  }, [loading, user, company])

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

  // Needs setup
  if (needsSetup) {
    return <SetupWizard onComplete={() => setNeedsSetup(false)} />
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
