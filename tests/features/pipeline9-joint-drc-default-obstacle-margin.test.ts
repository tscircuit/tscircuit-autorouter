import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("joint repair honors the declared default obstacle margin", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  srj.defaultObstacleMargin = 0.12
  for (const point of srj.connections[0]!.pointsToConnect) point.y = 0.36
  for (const pad of srj.obstacles.slice(0, 2)) pad.center.y = 0.36
  for (const point of fixture.routes[0]!.route) point.y = 0.36
  const originalRoutes = structuredClone(fixture.routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(solver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routes = solver.getOutput()
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srj.connections,
    originalConnections: srj.connections,
    hdRoutes: routes,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const reference = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
    drcOptions: { traceClearance: srj.defaultObstacleMargin },
  })
  expect(reference.errors).toHaveLength(0)
  expect(routes[0]!.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect(fixture.routes).toEqual(originalRoutes)
})
