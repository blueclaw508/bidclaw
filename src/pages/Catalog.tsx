import { BookOpen } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function CatalogPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
          Item Catalog
        </h1>
        <p className="mt-1 text-sm text-brand-text-muted">
          Your master list of labor rates, materials, equipment, and disposal lines.
        </p>
      </header>

      <EmptyState
        icon={BookOpen}
        title="No catalog items yet"
        description="Build your catalog so estimates auto-price. Labor and equipment go in once; every project pulls from here."
        ctaLabel="Add item"
        ctaDisabled
      />
    </div>
  )
}
