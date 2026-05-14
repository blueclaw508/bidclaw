import { Users } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function CustomersPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
          Customers
        </h1>
        <p className="mt-1 text-sm text-brand-text-muted">
          Your contact list. Linked to every project they own.
        </p>
      </header>

      <EmptyState
        icon={Users}
        title="No customers yet"
        description="Add a customer to attach them to a project. You can also create customers on the fly from any project."
        ctaLabel="Add customer"
        ctaDisabled
      />
    </div>
  )
}
