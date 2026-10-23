import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

export function createJointRepairRuntimeFixture(
  exhaustInitialBudget = false,
): Pipeline9JointDrcRepairSolver {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  if (exhaustInitialBudget) {
    const budget = solver.initialBoundedRegionalRepairSolver!.budget
    budget.maxRegions = 0
    budget.maxCandidateAttempts = 0
    budget.maxPathSearchNodes = 0
  }
  return solver
}
