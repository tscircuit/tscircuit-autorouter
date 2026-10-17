import { expect, spyOn, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("an incomplete parallel search cannot publish unresolved geometry or skip the original exact stage", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const solver = new Pipeline9JointDrcRepairSolver({
    srj, srjWithPointPairs: srj, originalSrj: srj,
    newConnections: srj.connections, newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), obstacles: srj.obstacles,
    layerCount: srj.layerCount, defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
    repairRuntime: { workerCount: 8, runNegotiations: (): never => { throw new Error("Unexpected search") } },
  })
  const bounded = solver.parallelBoundedRepairSolver!
  const step = spyOn(bounded, "_step").mockImplementation((): void => { bounded.solved = true })
  try {
    solver.step()
    expect(solver.solved).toBeFalse()
    expect(solver.stats.parallelRepairFinalDrcIssueCount).toBeGreaterThan(0)
    expect(solver.getCurrentPhase()).toBe("exactRepairSolver")
    solver.step()
    expect(solver.activeSubSolver).toBe(solver.exactRepairSolver)
    expect(solver.exactRepairSolver!.getOutput()).toEqual(fixture.routes)
  } finally {
    step.mockRestore()
  }
})
