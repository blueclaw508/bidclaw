import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard,
  PlusCircle,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

type Page = 'dashboard' | 'new-estimate' | 'settings'

interface AppLayoutProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  children: React.ReactNode
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'new-estimate', label: 'New Estimate', icon: <PlusCircle size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
]

export function AppLayout({ currentPage, onNavigate, children }: AppLayoutProps) {
  const { user, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'linear-gradient(180deg, #1e3a5f 0%, #2d5aa0 100%)' }}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-6">
          <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-lg font-semibold tracking-tight">BidClaw</span>
          <button
            className="ml-auto lg:hidden text-white/60 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id)
                setSidebarOpen(false)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                currentPage === item.id
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 truncate px-3 text-xs text-white/40">
            {user?.email}
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut size={20} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-6">
          <button
            className="lg:hidden"
            style={{ color: '#1e3a5f' }}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={24} />
          </button>
          <h1 className="text-lg font-semibold" style={{ color: '#1e3a5f' }}>
            {navItems.find((n) => n.id === currentPage)?.label ?? 'BidClaw'}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
