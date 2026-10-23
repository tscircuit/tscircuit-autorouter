import { expect, spyOn, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("an unpublished initial bounded improvement continues exact repair without changing public routes", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
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
  const initial = solver.initialBoundedRegionalRepairSolver!
  const getResult = initial.getResult.bind(initial)
  const resultSpy = spyOn(initial, "getResult").mockImplementation(() => ({
    ...getResult(),
    routes: initial.params.routes,
    publishedDrcIssueCount: 1,
    repaired: false,
  }))
  try {
    while (!solver.exactRepairSolver && !solver.failed) solver.step()
    expect(initial.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeFalse()
    expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeFalse()
    const continuation = initial.getRoutesForFurtherRepair()
    expect(initial.getResult().routes).toBe(initial.params.routes)
    expect(continuation).not.toEqual(original)
    expect(solver.exactRepairSolver!.params.hdRoutes).toBe(continuation)
    expect(fixture.routes).toEqual(original)
  } finally {
    resultSpy.mockRestore()
  }
})
