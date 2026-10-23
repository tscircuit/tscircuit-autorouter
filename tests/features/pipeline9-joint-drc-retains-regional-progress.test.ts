import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("joint repair retains validated regional progress without replacing the exact search input", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  srj.connections.push({
    name: "disconnected",
    pointsToConnect: [
      { x: -4, y: -3, layer: "top" },
      { x: 4, y: -3, layer: "top" },
    ],
  })
  fixture.routes.push({
    connectionName: "disconnected",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: -3, z: 0 },
      { x: 4, y: -3, z: 0 },
    ],
    vias: [],
  })
  const original = structuredClone(fixture.routes)
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

  while (!solver.exactRepairSolver && !solver.failed) solver.step()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  const initial = solver.initialBoundedRegionalRepairSolver!
  const published = initial.getResult()
  const continuation = initial.getRoutesForFurtherRepair()
  expect(published.routes).toBe(initial.params.routes)
  expect(continuation).not.toBe(published.routes)
  expect(solver.exactRepairSolver!.inputHdRoutes).toEqual(original)
  expect(solver.exactRepairSolver!.inputHdRoutes).not.toBe(continuation)
  expect(published.finalDrcIssueCount!).toBeLessThan(
    published.publishedDrcIssueCount!,
  )

  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).not.toEqual(published.routes)
  expect(solver.stats.finalDrcIssueCount).toBeLessThan(
    published.publishedDrcIssueCount!,
  )
  expect(initial.getResult().routes).toBe(published.routes)
  expect(fixture.routes).toEqual(original)
})
