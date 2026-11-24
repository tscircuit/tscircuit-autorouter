import {
  type getDrcSnapshot,
  hasNewTraceObstacleOverlaps,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

type DrcSnapshot = ReturnType<typeof getDrcSnapshot>
type RawDrcErrors = NonNullable<DrcSnapshot["rawErrors"]>

function getConnectivityErrorIds(errors: RawDrcErrors): Set<string> {
  const ids = new Set<string>()
  for (const error of errors) {
    const id = error.pcb_trace_error_id
    if (
      typeof id === "string" &&
      /^(missing_connection|missing_layer_connection|disconnected_endpoint)_/.test(
        id,
      )
    ) {
      ids.add(id)
    }
  }
  return ids
}

export function canRetainPipeline9RepairCheckpoint(
  candidate: DrcSnapshot,
  baseline: DrcSnapshot,
): boolean {
  // Targeted errors may omit a disconnected trace. Require complete evidence
  // from both board-reference evaluations before replacing the restored route.
  if (!candidate.rawErrors || !baseline.rawErrors) return false
  if (
    candidate.count >= baseline.count ||
    hasNewTraceObstacleOverlaps(candidate, baseline)
  ) {
    return false
  }
  const baselineConnectivity = getConnectivityErrorIds(baseline.rawErrors)
  return [...getConnectivityErrorIds(candidate.rawErrors)].every((id) =>
    baselineConnectivity.has(id),
  )
}
