import {
  type getDrcSnapshot,
  hasNewTraceObstacleOverlaps,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

type DrcSnapshot = ReturnType<typeof getDrcSnapshot>
type DrcError = NonNullable<DrcSnapshot["rawErrors"]>[number]
type ProtectedFindingKey = string

function getProtectedFindingKey(
  error: DrcError,
): ProtectedFindingKey | undefined {
  const id = error.pcb_trace_error_id
  if (
    typeof id === "string" &&
    /^(missing_connection|missing_layer_connection|disconnected_endpoint|misaligned_via)_/.test(
      id,
    )
  ) {
    return id
  }
  const clearance = error.worst_actual_clearance ?? error.actual_clearance
  if (
    error.drc_source === "fixed_copper" ||
    (typeof clearance === "number" && clearance < 0) ||
    (typeof id === "string" && id.startsWith("trace_too_close_to_board_"))
  ) {
    // Require the same complete record to carry an existing physical finding
    // forward. A changed location, depth, or unknown identity is not proof.
    return JSON.stringify(error)
  }
}

function getLargestMeasuredSpacingDeficit(
  findings: NonNullable<DrcSnapshot["rawErrors"]>,
): number {
  let largest = 0
  for (const finding of findings) {
    const actual = finding.worst_actual_clearance ?? finding.actual_clearance
    const minimum = finding.minimum_clearance
    if (
      typeof actual === "number" &&
      Number.isFinite(actual) &&
      actual >= 0 &&
      typeof minimum === "number" &&
      Number.isFinite(minimum)
    ) {
      largest = Math.max(largest, minimum - actual)
    }
  }
  return largest
}

export function canRetainPipeline9RepairCheckpoint(
  candidate: DrcSnapshot,
  baseline: DrcSnapshot,
): boolean {
  if (!candidate.rawErrors || !baseline.rawErrors) return false
  if (
    candidate.count >= baseline.count ||
    candidate.issueScore > baseline.issueScore ||
    getLargestMeasuredSpacingDeficit(candidate.rawErrors) >
      getLargestMeasuredSpacingDeficit(baseline.rawErrors) ||
    hasNewTraceObstacleOverlaps(candidate, baseline)
  ) {
    return false
  }

  const baselineFindings = new Map<ProtectedFindingKey, number>()
  for (const error of baseline.rawErrors) {
    const key = getProtectedFindingKey(error)
    if (key !== undefined) {
      baselineFindings.set(key, (baselineFindings.get(key) ?? 0) + 1)
    }
  }
  for (const error of candidate.rawErrors) {
    const key = getProtectedFindingKey(error)
    if (key === undefined) continue
    const remaining = baselineFindings.get(key) ?? 0
    if (remaining === 0) return false
    baselineFindings.set(key, remaining - 1)
  }
  return true
}
