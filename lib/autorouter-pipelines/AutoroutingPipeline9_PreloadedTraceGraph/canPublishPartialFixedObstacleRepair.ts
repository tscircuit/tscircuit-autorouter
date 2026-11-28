import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { isViaPadClearanceError } from "./isViaPadClearanceError"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

/**
 * Partial publication permits inherited pad and board-edge errors that did
 * not worsen. Call only after the physical obstacle and new-via guards pass.
 * Connectivity and moving copper errors require a complete repair.
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
    const boardEdgeClearance = error.actual_board_edge_clearance
    const minimumBoardEdgeClearance = error.minimum_board_edge_clearance
    if (
      error.type === "pcb_trace_error" &&
      typeof error.pcb_trace_error_id === "string" &&
      typeof minimumBoardEdgeClearance === "number" &&
      Number.isFinite(minimumBoardEdgeClearance) &&
      typeof boardEdgeClearance === "number" &&
      Number.isFinite(boardEdgeClearance)
    ) {
      const originalIndex = unmatchedErrors.findIndex(
        (original) =>
          original.type === error.type &&
          original.pcb_trace_id === error.pcb_trace_id &&
          original.pcb_trace_error_id === error.pcb_trace_error_id &&
          original.minimum_board_edge_clearance === minimumBoardEdgeClearance &&
          typeof original.actual_board_edge_clearance === "number" &&
          Number.isFinite(original.actual_board_edge_clearance) &&
          boardEdgeClearance >= original.actual_board_edge_clearance,
      )
      if (originalIndex === -1) return false
      unmatchedErrors.splice(originalIndex, 1)
      continue
    }
    const prefix = `overlap_${error.pcb_trace_id}_`
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
