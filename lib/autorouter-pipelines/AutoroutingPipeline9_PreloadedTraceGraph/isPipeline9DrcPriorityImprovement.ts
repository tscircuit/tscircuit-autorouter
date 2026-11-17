import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

export const isPipeline9PriorityDrcError = (
  error: Pipeline9DrcError,
): boolean => {
  const isFixedCopper = error.drc_source === "fixed_copper"
  const hasCopperContact =
    typeof error.actual_clearance === "number" &&
    error.actual_clearance <= 0
  return !isFixedCopper || hasCopperContact
}

/** Compare reference errors after the physical candidate guards have passed. */
export const isPipeline9DrcPriorityImprovement = ({
  currentErrors,
  candidateErrors,
}: {
  currentErrors: Pipeline9DrcError[]
  candidateErrors: Pipeline9DrcError[]
}): boolean => {
  const currentHasPriorityErrors = currentErrors.some(isPipeline9PriorityDrcError)
  const candidateHasPriorityErrors = candidateErrors.some(isPipeline9PriorityDrcError)
  // Positive fixed-copper clearances follow circuit errors and physical shorts.
  // Keep that priority consistent with the errors included in the repair score.
  if (currentHasPriorityErrors !== candidateHasPriorityErrors) {
    return !candidateHasPriorityErrors
  }
  return candidateErrors.length < currentErrors.length
}
