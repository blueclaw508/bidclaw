import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequireAuth } from '@/components/RequireAuth'
import { AppShell } from '@/components/AppShell'
import { PromoScreen } from '@/components/PromoScreen'
import AuthCallback from '@/pages/AuthCallback'
import ProjectsPage from '@/pages/Projects'
import CustomersPage from '@/pages/Customers'
import CatalogPage from '@/pages/Catalog'
import SettingsPage from '@/pages/Settings'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
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
              <Route path="projects"  element={<ProjectsPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="catalog"   element={<CatalogPage />} />
              <Route path="settings"  element={<SettingsPage />} />
            </Route>

            {/* Anything else → marketing page */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
