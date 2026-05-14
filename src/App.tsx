import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequireAuth } from '@/components/RequireAuth'
import { AppShell } from '@/components/AppShell'
import { PromoScreen } from '@/components/PromoScreen'
import { RouteLoading } from '@/components/RouteLoading'

// Route-level code splitting. PromoScreen and AppShell stay eager because
// they're on the critical path for / and /app/* respectively (and the
// AppShell layout is shared across every /app/* route, so loading it
// once is fine). Everything else is lazy.
const AuthCallback       = lazy(() => import('@/pages/AuthCallback'))
const ProjectsPage       = lazy(() => import('@/pages/Projects'))
const ProjectDetailPage  = lazy(() => import('@/pages/ProjectDetail'))
const CustomersPage      = lazy(() => import('@/pages/Customers'))
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetail'))
const CatalogPage        = lazy(() => import('@/pages/Catalog'))
const SettingsPage       = lazy(() => import('@/pages/Settings'))

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              {/* Public — marketing page (with embedded magic-link login section) */}
              <Route path="/" element={<PromoScreen />} />
              <Route path="/login" element={<PromoScreen />} />

              {/* Magic-link return URL */}
              <Route path="/auth/callback" element={<AuthCallback />} />

              {/* Protected — /app/* lives behind RequireAuth + AppShell */}
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="projects" replace />} />
                <Route path="projects"      element={<ProjectsPage />} />
                <Route path="projects/:id"  element={<ProjectDetailPage />} />
                <Route path="customers"     element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="catalog"       element={<CatalogPage />} />
                <Route path="settings"      element={<SettingsPage />} />
              </Route>

              {/* Anything else → marketing page */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
