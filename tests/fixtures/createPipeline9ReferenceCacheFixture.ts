import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

export function createPipeline9ReferenceCacheFixture(): {
  solver: Pipeline9JointDrcRepairSolver
  reference: DrcEvaluator
  routes: HighDensityRoute[]
} {
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
  const view = solver as unknown as {
    cachedReferenceDrcEvaluator?: DrcEvaluator
  }
  if (!view.cachedReferenceDrcEvaluator) {
    throw new Error("Reference cache fixture did not create its evaluator")
  }
  return {
    solver,
    reference: view.cachedReferenceDrcEvaluator,
    routes: fixture.routes,
  }
}
