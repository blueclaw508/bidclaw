// Jamie Error Classification
// Routes errors to the correct friendly modal instead of raw toast messages

import type { JamieErrorType } from '@/components/JamieErrorModal'

/**
 * Classify a Jamie error into one of two user-facing states:
 * - 'needs_info': Jamie didn't get enough input to work with
 * - 'snag': Something broke on the backend (timeout, API failure, parse error)
 */
export function classifyJamieError(errorMessage: string): JamieErrorType {
  const msg = errorMessage.toLowerCase()

  // "Needs more info" indicators — empty input, missing data, unparseable response
  // (unparseable usually means Jamie returned prose instead of JSON, which means
  // the input was too vague for structured output)
  if (
    msg.includes('unparseable') ||
    msg.includes('no response') ||
    msg.includes('empty response') ||
    msg.includes('could not build') ||
    msg.includes('could not write scope') ||
    msg.includes('could not generate summary') ||
    msg.includes('could not review')
  ) {
    return 'needs_info'
  }

  // Everything else is a "snag" (timeout, network, 5xx, abort)
  return 'snag'
}

/**
 * Custom error class for Jamie errors that carries the error type.
 * Thrown from jamie.ts / anthropic.ts, caught in App.tsx to show the modal.
 */
export class JamieError extends Error {
  type: JamieErrorType

  constructor(message: string, type?: JamieErrorType) {
    super(message)
    this.name = 'JamieError'
    this.type = type ?? classifyJamieError(message)
  }
}
