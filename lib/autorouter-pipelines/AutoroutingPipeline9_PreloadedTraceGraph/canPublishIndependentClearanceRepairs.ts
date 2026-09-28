import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

/** Call only after changed wire segments are clear and all via sites are fixed. */
export const canPublishIndependentClearanceRepairs = (
  initialErrors: Pipeline9DrcError[],
  remainingErrors: Pipeline9DrcError[],
): boolean => {
  if (remainingErrors.length >= initialErrors.length) return false
  const identity = (error: Pipeline9DrcError): string | undefined => {
    if (error.type === "pcb_via_trace_clearance_error") {
      return JSON.stringify([error.type, error.pcb_trace_id, error.pcb_via_id])
    }
    if (error.type === "pcb_pad_trace_clearance_error") {
      return JSON.stringify([error.type, error.pcb_trace_id, error.pcb_pad_id])
    }
    if (
      error.type === "pcb_via_clearance_error" &&
      Array.isArray(error.pcb_via_ids)
    ) {
      return JSON.stringify([error.type, [...error.pcb_via_ids].sort()])
    }
    if (
      error.type === "pcb_trace_error" &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(`overlap_${error.pcb_trace_id}_`)
    ) {
      return JSON.stringify([error.type, error.pcb_trace_error_id])
    }
    // Connectivity, boundary and unknown errors require a complete repair.
    return undefined
  }
  const unmatched = [...initialErrors]
  for (const error of remainingErrors) {
    const key = identity(error)
    if (key === undefined) return false
    const index = unmatched.findIndex((previous) => identity(previous) === key)
    if (index < 0) return false
    const previous = unmatched.splice(index, 1)[0]!
    // Overlap severity is proven by the changed-segment geometry guard.
    if (error.type === "pcb_trace_error") continue
    if (
      typeof error.actual_clearance !== "number" ||
      !Number.isFinite(error.actual_clearance) ||
      typeof previous.actual_clearance !== "number" ||
      !Number.isFinite(previous.actual_clearance) ||
      error.minimum_clearance !== previous.minimum_clearance ||
      error.actual_clearance < previous.actual_clearance
    ) {
      return false
    }
  }
  return true
}
