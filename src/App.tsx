import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { SetupProvider } from '@/contexts/SetupContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequireAuth } from '@/components/RequireAuth'
import { AppShell } from '@/components/AppShell'
import { PromoScreen } from '@/components/PromoScreen'
import { RouteLoading } from '@/components/RouteLoading'

// Route-level code splitting. PromoScreen and AppShell stay eager because
// they're on the critical path for / and /app/* respectively (and the
// AppShell layout is shared across every /app/* route, so loading it
// once is fine). Everything else is lazy.
const AuthCallback              = lazy(() => import('@/pages/AuthCallback'))
const ProjectsPage              = lazy(() => import('@/pages/Projects'))
const ProjectDetailPage         = lazy(() => import('@/pages/ProjectDetail'))
const CustomersPage             = lazy(() => import('@/pages/Customers'))
const CustomerDetailPage        = lazy(() => import('@/pages/CustomerDetail'))
const CatalogPage               = lazy(() => import('@/pages/Catalog'))
const KitsPage                  = lazy(() => import('@/pages/Kits'))
const KitDetailPage             = lazy(() => import('@/pages/KitDetail'))
const SettingsPage                  = lazy(() => import('@/pages/Settings'))
const CompanyProfileSettingsPage    = lazy(() => import('@/pages/CompanyProfileSettings'))
const EnterMyNumbersSettingsPage    = lazy(() => import('@/pages/EnterMyNumbersSettings'))
// MeasureView pulls in pdfjs-dist (~300 kB raw) — keeping it lazy so
// nobody pays the cost until they actually open the measure tool.
const MeasureViewPage           = lazy(() => import('@/pages/MeasureView'))

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
                    <SetupProvider>
                      <AppShell />
                    </SetupProvider>
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="projects" replace />} />
                <Route path="projects"      element={<ProjectsPage />} />
                <Route path="projects/:id"  element={<ProjectDetailPage />} />
                <Route
                  path="projects/:projectId/measure/:fileId"
                  element={<MeasureViewPage />}
                />
                <Route path="customers"     element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="catalog"       element={<CatalogPage />} />
                <Route path="kits"          element={<KitsPage />} />
                <Route path="kits/:kitId"   element={<KitDetailPage />} />
                <Route path="settings"                      element={<SettingsPage />} />
                <Route path="settings/company-profile"      element={<CompanyProfileSettingsPage />} />
                <Route path="settings/enter-my-numbers"     element={<EnterMyNumbersSettingsPage />} />
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
