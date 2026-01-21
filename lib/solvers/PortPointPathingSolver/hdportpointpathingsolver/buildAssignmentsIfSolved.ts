import { buildPortPointAssignmentsFromSolvedRoutes } from "./buildPortPointAssignmentsFromSolvedRoutes"
import type { HgPortPointPathingSolver } from "./HgPortPointPathingSolver"

/**
 * Build assignments once the solver is solved.
 */
export function buildAssignmentsIfSolved({
  solver,
}: {
  solver: HgPortPointPathingSolver
}): void {
  if (!solver.solved || solver.assignmentsBuilt) {
    return
  }
  const assignments = buildPortPointAssignmentsFromSolvedRoutes({
    solvedRoutes: solver.solvedRoutes,
    connectionResults: solver.connectionsWithResults,
    inputNodes: solver.inputNodes,
  })
  solver.connectionsWithResults = assignments.connectionsWithResults
  solver.assignedPortPoints = assignments.assignedPortPoints
  solver.nodeAssignedPortPoints = assignments.nodeAssignedPortPoints
  solver.assignmentsBuilt = true
}
