import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSetup } from '@/contexts/SetupContext'

/**
 * Gating hook for actions that require completed setup.
 *
 * Returns `gateAction(callback)` which:
 *   - When setup IS complete: returns `callback` unchanged. The caller
 *     wires it to onClick / onSubmit / etc. and it runs normally.
 *   - When setup is NOT complete: returns a wrapper that, when invoked,
 *     toasts "Complete your setup first" and opens the WizardModal.
 *     The original callback never fires until setup completes.
 *
 * Phase 4 ships the hook + a verification harness. Prompts 6+ are
 * the real consumers — "New Proposal" button (Prompt 6) and "Run
 * Jamie" button (Prompt 7) both wrap their handlers via gateAction.
 *
 * Example:
 *   const { gateAction } = useSetupGate()
 *   const handleNewProposal = gateAction(() => {
 *     // open proposal creation modal
 *   })
 *   <button onClick={handleNewProposal}>New Proposal</button>
 */
export function useSetupGate(): {
  setupCompleted: boolean
  gateAction: <Args extends unknown[]>(
    callback: (...args: Args) => void
  ) => (...args: Args) => void
} {
  const { setupCompleted, openWizard } = useSetup()

  const gateAction = useCallback(
    <Args extends unknown[]>(callback: (...args: Args) => void) => {
      if (setupCompleted) return callback
      return () => {
        toast.error('Complete your setup first to use this feature.')
        openWizard()
      }
    },
    [setupCompleted, openWizard]
  )

  return { setupCompleted, gateAction }
}
