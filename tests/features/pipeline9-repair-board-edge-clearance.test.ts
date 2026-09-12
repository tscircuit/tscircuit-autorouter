import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"
test("Pipeline9 repairs trace clearance against the declared board boundary", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  srj.bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 }
  srj.minBoardEdgeClearance = 0.2
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 }, { x: -4, y: 4.9, z: 0 },
    { x: 4, y: 4.9, z: 0 }, { x: 4, y: 0, z: 0 },
  ]
  const drcEvaluator = createPipeline9RelaxedDrcEvaluator({
    originalSrj: srj, srjWithPointPairs: srj, mutatedPreloadedTraces: [],
    connections: srj.connections, originalConnections: srj.connections,
    layerCount: 2, obstacles: srj.obstacles, defaultViaHoleDiameter: 0.2,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  const before = drcEvaluator({ traces: [], routes: fixture.routes })
  expect(Array.isArray(before) ? before.length : before.errors.length).toBeGreaterThan(0)
  const routes = applyPipeline9ClearanceProjection({ originalSrj: srj, routes: fixture.routes, drcEvaluator })
  const after = drcEvaluator({ traces: [], routes })
  expect(Array.isArray(after) ? after : after.errors).toEqual([])
})
