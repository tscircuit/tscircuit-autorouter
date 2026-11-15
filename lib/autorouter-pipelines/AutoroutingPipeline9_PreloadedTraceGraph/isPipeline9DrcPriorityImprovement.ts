import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

/** Compare reference errors after the physical candidate guards have passed. */
export const isPipeline9DrcPriorityImprovement = ({
  currentErrors,
  candidateErrors,
}: {
  currentErrors: Pipeline9DrcError[]
  candidateErrors: Pipeline9DrcError[]
}): boolean => {
  const currentHasCircuitJsonErrors = currentErrors.some(
    (error): boolean => error.drc_source !== "fixed_copper",
  )
  const candidateHasCircuitJsonErrors = candidateErrors.some(
    (error): boolean => error.drc_source !== "fixed_copper",
  )
  // Clearing circuit errors can reveal inherited fixed-copper contacts.
  // Compare priority before count so that this progress is retained.
  if (currentHasCircuitJsonErrors !== candidateHasCircuitJsonErrors) {
    return !candidateHasCircuitJsonErrors
  }
  return candidateErrors.length < currentErrors.length
}
