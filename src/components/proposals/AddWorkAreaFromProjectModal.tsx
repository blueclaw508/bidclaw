import { useMemo } from 'react'
import { ClipboardList } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { addWorkAreaToProposal } from '@/lib/proposals'
import type { WorkArea } from '@/lib/types'
import { toast } from 'sonner'

/**
 * Modal picker: lists the project's work areas and lets the contractor
 * attach one to this proposal. Already-attached work areas are filtered
 * out so the partial unique index (proposal_id, work_area_id) WHERE
 * work_area_id IS NOT NULL never gets violated.
 *
 * Click a row → addWorkAreaToProposal({ workAreaId }) → toast + close +
 * onAdded callback (parent refreshes).
 */
interface AddWorkAreaFromProjectModalProps {
  open: boolean
  onClose: () => void
  proposalId: string
  projectWorkAreas: WorkArea[]
  /** Set of work_area_ids already attached to this proposal — filtered out of the picker. */
  alreadyAttachedWorkAreaIds: Set<string>
  onAdded: () => void
}

export function AddWorkAreaFromProjectModal({
  open,
  onClose,
  proposalId,
  projectWorkAreas,
  alreadyAttachedWorkAreaIds,
  onAdded,
}: AddWorkAreaFromProjectModalProps) {
  const available = useMemo(
    () => projectWorkAreas.filter((wa) => !alreadyAttachedWorkAreaIds.has(wa.id)),
    [projectWorkAreas, alreadyAttachedWorkAreaIds]
  )

  const handlePick = async (workAreaId: string) => {
    try {
      await addWorkAreaToProposal({ proposalId, workAreaId })
      toast.success('Work area added.')
      onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add work area.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add work area from project"
      description="Pick a project work area to attach to this proposal."
      size="lg"
    >
      {available.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          {projectWorkAreas.length === 0
            ? 'This project has no work areas yet. Add work areas on the project page first, or use "+ Add ad-hoc" instead.'
            : 'All of this project\'s work areas are already attached. Use "+ Add ad-hoc" for change orders.'}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {available.map((wa) => (
            <li
              key={wa.id}
              className="border-b border-gray-100 last:border-0"
            >
              <button
                type="button"
                onClick={() => void handlePick(wa.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {wa.name}
                  </div>
                  {wa.description && (
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {wa.description}
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}
