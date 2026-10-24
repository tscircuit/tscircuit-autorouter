import type { FindClearancePathSolver } from "./FindClearancePathSolver"

/** Experimental operation counts only; excluded from native stable solver stats. */
export function addMeshSearchDiagnostics(
  target: Record<string, number>,
  source: Readonly<Record<string, number>>,
): void {
  for (const [name, value] of Object.entries(source))
    target[name] = (target[name] ?? 0) + value
}

export function getMeshSearchDiagnostics(
  child: FindClearancePathSolver,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [name, value] of Object.entries(child.stats))
    if ((name.startsWith("mesh") || name === "corridorEdgeChecks") && typeof value === "number")
      result[name] = value
  const started = typeof result.meshConstructionWork === "number"
  result.meshPathChildren = 1
  result.meshPathChildrenPending = child.solved || child.failed ? 0 : 1
  result.meshPathChildrenFailed = child.failed ? 1 : 0
  result.meshPathChildrenFinished = child.solved ? 1 : 0
  result.meshSearchesStarted = started ? 1 : 0
  result.meshSearchNodesPopped = child.stats.nodesPopped
  if (child.solved && started) {
    const reason = child.stats.completionReason
    const key = reason === "found" ? "meshFoundSearches"
      : reason === "node-limit" ? "meshNodeLimitSearches"
      : reason === "geometry-limit" ? "meshGeometryLimitSearches"
      : "meshExhaustedSearches"
    result[key] = 1
  }
  return result
}
