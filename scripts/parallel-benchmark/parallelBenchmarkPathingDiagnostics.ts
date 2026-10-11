type TinySolverDiagnosticSource = {
  iterations: number
  MAX_ITERATIONS: number
  solved: boolean
  failed: boolean
  stats: Record<string, unknown>
  topology: { portCount: number; regionCount: number }
  problem: { routeCount: number }
  state: { ripCount: number; unroutedRoutes: number[] }
  routeAttemptCountByRouteId: Uint32Array
  routeSuccessCountByRouteId: Uint32Array
  getSolverName: () => string
}

type PathingDiagnosticSource = {
  solved?: boolean
  tinyPipelineSolver?: { getSolver: (name: string) => TinySolverDiagnosticSource | undefined }
  getSolvedTinySolver?: () => TinySolverDiagnosticSource
}

/** Read existing search counters after timing, without instrumenting hot paths. */
export const collectParallelBenchmarkPathingDiagnostics = (
  source: unknown,
): Record<string, unknown> | undefined => {
  if (!source || typeof source !== "object") return undefined
  const pathing = source as PathingDiagnosticSource
  if (!pathing.solved || typeof pathing.getSolvedTinySolver !== "function" || !pathing.tinyPipelineSolver) return undefined
  const solveGraph = pathing.tinyPipelineSolver.getSolver("solveGraph")
  if (!solveGraph) throw new Error("Solved pathing pipeline is missing its solveGraph diagnostics")
  const finalStateSolver = pathing.getSolvedTinySolver()
  const attempts = solveGraph.routeAttemptCountByRouteId
  const successes = solveGraph.routeSuccessCountByRouteId
  return {
    parentSearchSolverName: solveGraph.getSolverName(),
    parentSearchIterations: solveGraph.iterations,
    parentSearchMaxIterations: solveGraph.MAX_ITERATIONS,
    parentSearchStats: { ...solveGraph.stats },
    finalStateSolverName: finalStateSolver.getSolverName(),
    finalStateSolverIterations: finalStateSolver.iterations,
    finalStateSolverStats: { ...finalStateSolver.stats },
    portCount: solveGraph.topology.portCount,
    regionCount: solveGraph.topology.regionCount,
    routeCount: solveGraph.problem.routeCount,
    ripCount: solveGraph.state.ripCount,
    remainingRouteCount: solveGraph.state.unroutedRoutes.length,
    routeAttemptCount: attempts.reduce((sum, count) => sum + count, 0),
    routeSuccessCount: successes.reduce((sum, count) => sum + count, 0),
    maxRouteAttemptCount: attempts.reduce((maximum, count) => Math.max(maximum, count), 0),
    nativeCompletionChildIterationsAvailable: false,
  }
}
