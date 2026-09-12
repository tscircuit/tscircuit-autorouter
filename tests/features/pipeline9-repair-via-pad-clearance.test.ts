import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"
test("Pipeline9 repairs a via that clears traces but is too close to an unrelated pad", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  srj.minPadEdgeToPadEdgeClearance = 0.1
  srj.obstacles[1]!.layers = ["bottom"]
  srj.connections[0]!.pointsToConnect[1]!.layer = "bottom"
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 }, { x: 0, y: 0.42, z: 0 },
    { x: 0, y: 0.42, z: 1 }, { x: 4, y: 0, z: 1 },
  ]
  fixture.routes[0]!.vias = [{ x: 0, y: 0.42 }]
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
