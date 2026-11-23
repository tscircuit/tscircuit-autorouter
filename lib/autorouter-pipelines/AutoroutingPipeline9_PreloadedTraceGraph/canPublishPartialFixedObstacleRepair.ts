import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { isViaPadClearanceError } from "./isViaPadClearanceError"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

const isIdenticalErrorValue = (left: unknown, right: unknown): boolean => {
  if (typeof left === "number" || typeof right === "number") {
    return (
      typeof left === "number" &&
      typeof right === "number" &&
      Number.isFinite(left) &&
      Number.isFinite(right) &&
      Object.is(left, right)
    )
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return left === right
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => isIdenticalErrorValue(item, right[index]))
    )
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  if (keys.length !== Object.keys(rightRecord).length) return false
  return keys.every(
    (key) =>
      Object.hasOwn(rightRecord, key) &&
      isIdenticalErrorValue(leftRecord[key], rightRecord[key]),
  )
}

const isPortConnectivityTraceError = (
  error: Pipeline9DrcError,
  overlapPrefix: string,
): boolean =>
  error.type === "pcb_trace_error" &&
  error.drc_source === undefined &&
  typeof error.pcb_trace_error_id === "string" &&
  !error.pcb_trace_error_id.startsWith(overlapPrefix) &&
  Array.isArray(error.pcb_port_ids) &&
  error.pcb_port_ids.length > 0 &&
  error.pcb_port_ids.every((portId) => typeof portId === "string")

/**
 * Partial publication is limited to remaining fixed-pad errors covered by the
 * physical obstacle non-regression guard, plus pre-existing port connectivity
 * errors that remain identical to the stage input (matched at most once). Call
 * only after the physical obstacle guard and new-via guard pass. Unknown,
 * portless disconnected-endpoint, newly introduced connectivity, and moving
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
  if (remainingErrors.length === 0) return true
  const padIds = new Set(
    createPcbPadElements(originalSrj).flatMap((element) =>
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
    if (isPortConnectivityTraceError(error, prefix)) {
      const unchangedIndex = unmatchedErrors.findIndex((original) =>
        isIdenticalErrorValue(original, error),
      )
      if (unchangedIndex === -1) return false
      unmatchedErrors.splice(unchangedIndex, 1)
      continue
    }
    const overlapPadId =
      error.type === "pcb_trace_error" &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(prefix)
        ? error.pcb_trace_error_id.slice(prefix.length)
        : undefined
    const isViaPadClearance = isViaPadClearanceError(error)
    const isPadClearance =
      error.type === "pcb_pad_trace_clearance_error" || isViaPadClearance
    const padId = isViaPadClearance
      ? error.pcb_pad_ids.find((id) => padIds.has(id))
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
          ? isViaPadClearanceError(original) &&
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
