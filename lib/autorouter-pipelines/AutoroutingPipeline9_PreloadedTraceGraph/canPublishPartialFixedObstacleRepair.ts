import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

/**
 * Partial publication is limited to remaining fixed-pad errors covered by the
 * physical obstacle non-regression guard. Call only after that guard and the
 * new-via guard pass. Unknown, connectivity and moving
 * copper errors still require a completely reference-clean repair.
 */
export const canPublishPartialFixedObstacleRepair = ({
  originalSrj,
  initialErrors,
  remainingErrors,
}: {
  originalSrj: SimpleRouteJson
  initialErrors: Pipeline9DrcError[]
  remainingErrors: Pipeline9DrcError[]
}): boolean => {
  if (remainingErrors.length >= initialErrors.length) return false
  const padIds = new Set(
    convertToCircuitJson(originalSrj, []).flatMap((element) =>
      element.type === "pcb_smtpad"
        ? [element.pcb_smtpad_id]
        : element.type === "pcb_plated_hole"
          ? [element.pcb_plated_hole_id]
          : [],
    ),
  )
  const unmatchedErrors = [...initialErrors]
  for (const error of remainingErrors) {
    if (typeof error.pcb_trace_id !== "string") return false
    const prefix = `overlap_${error.pcb_trace_id}_`
    const overlapPadId =
      error.type === "pcb_trace_error" &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(prefix)
        ? error.pcb_trace_error_id.slice(prefix.length)
        : undefined
    const isViaPadClearance =
      error.type === "pcb_pad_pad_clearance_error" &&
      Array.isArray(error.pcb_via_ids) &&
      error.pcb_via_ids.length === 1 &&
      typeof error.pcb_via_ids[0] === "string" &&
      Array.isArray(error.pcb_pad_ids) &&
      error.pcb_pad_ids.length === 2 &&
      error.pcb_pad_ids.includes(error.pcb_via_ids[0])
    const isPadClearance =
      error.type === "pcb_pad_trace_clearance_error" || isViaPadClearance
    const padId = isViaPadClearance
      ? (error.pcb_pad_ids as string[]).find((id) => padIds.has(id))
      : isPadClearance
        ? error.pcb_pad_id
        : overlapPadId
    if (typeof padId !== "string" || !padIds.has(padId)) return false
    // Reference via ordinals can change when an earlier via is removed.
    // The physical new-via guard proves correspondence; match its fixed pad
    // and owning trace here, preserving the multiset and clearance severity.
    const originalIndex = unmatchedErrors.findIndex(
      (original) =>
        original.type === error.type &&
        original.pcb_trace_id === error.pcb_trace_id &&
        (isViaPadClearance
          ? Array.isArray(original.pcb_via_ids) &&
            original.pcb_via_ids.length === 1 &&
            Array.isArray(original.pcb_pad_ids) &&
            original.pcb_pad_ids.includes(padId)
          : isPadClearance
            ? original.pcb_pad_id === padId
            : original.pcb_trace_error_id === error.pcb_trace_error_id),
    )
    if (originalIndex === -1) return false
    const original = unmatchedErrors.splice(originalIndex, 1)[0]!
    if (
      isPadClearance &&
      (typeof error.actual_clearance !== "number" ||
        !Number.isFinite(error.actual_clearance) ||
        typeof original.actual_clearance !== "number" ||
        !Number.isFinite(original.actual_clearance) ||
        typeof error.minimum_clearance !== "number" ||
        !Number.isFinite(error.minimum_clearance) ||
        error.minimum_clearance !== original.minimum_clearance ||
        error.actual_clearance < original.actual_clearance)
    ) {
      return false
    }
  }
  return true
}
