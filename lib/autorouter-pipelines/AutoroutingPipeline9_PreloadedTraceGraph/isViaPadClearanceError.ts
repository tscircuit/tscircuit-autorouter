import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

type ViaPadClearanceError = Pipeline9DrcError & {
  type: "pcb_pad_pad_clearance_error"
  pcb_trace_id: string
  pcb_via_ids: [string]
  pcb_pad_ids: [string, string]
}

export const isViaPadClearanceError = (
  error: Pipeline9DrcError,
): error is ViaPadClearanceError => {
  if (
    error.type !== "pcb_pad_pad_clearance_error" ||
    typeof error.pcb_trace_id !== "string"
  ) {
    return false
  }
  const { pcb_via_ids: viaIds, pcb_pad_ids: padIds } = error
  if (
    !Array.isArray(viaIds) ||
    viaIds.length !== 1 ||
    typeof viaIds[0] !== "string"
  ) {
    return false
  }
  return (
    Array.isArray(padIds) &&
    padIds.length === 2 &&
    typeof padIds[0] === "string" &&
    typeof padIds[1] === "string" &&
    padIds.includes(viaIds[0])
  )
}
