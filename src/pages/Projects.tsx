import { ClipboardList } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function ProjectsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
          Projects
        </h1>
        <p className="mt-1 text-sm text-brand-text-muted">
          Every job, from first estimate to signed proposal to done.
        </p>
      </header>

      <EmptyState
        icon={ClipboardList}
        title="No projects yet"
        description="Create your first project to start tracking customers, work areas, measurements, and proposals."
        ctaLabel="New project"
        ctaDisabled
      />
    </div>
  )
}
