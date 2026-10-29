import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../../fixtures/pipeline9-bounded-regional-repair-fixture"

function jointState(solver: Pipeline9JointDrcRepairSolver): unknown {
  const clocks = new Set(["indexedDrcEvaluationTimeMs", "initialBoundedRegionalRepairTimeMs", "boundedRegionalRepairTimeMs"])
  const stats = Object.fromEntries(Object.entries(solver.stats).filter(([key]) => !clocks.has(key)))
  return {
    solved: solver.solved, failed: solver.failed, error: solver.error,
    iterations: solver.iterations, MAX_ITERATIONS: solver.MAX_ITERATIONS,
    progress: solver.progress, stats,
    childName: solver.activeSubSolver?.constructor.name,
    childIterations: solver.activeSubSolver?.iterations,
  }
}

test("Joint shares one persistent scratch ledger across its repair children while preserving native nonclock state", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const input = {
    srj: fixture.originalSrj, srjWithPointPairs: fixture.originalSrj,
    originalSrj: fixture.originalSrj, newConnections: fixture.originalSrj.connections,
    newHdRoutes: fixture.routes, updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set<string>(),
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj), obstacles: fixture.originalSrj.obstacles,
    layerCount: 2, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  }
  const reference = new Pipeline9JointDrcRepairSolver(input)
  const candidate = new Pipeline9JointDrcRepairSolver({ ...input, experimentRepairSearchScratch: true })
  const ledger = candidate.repairSearchScratchStats
  expect(ledger).toBeDefined()
  expect(reference.repairSearchScratchStats).toBeUndefined()
  let steps = 0
  while (!reference.solved && !reference.failed) {
    reference.step(); candidate.step()
    expect(jointState(candidate)).toEqual(jointState(reference))
    expect(candidate.repairSearchScratchStats).toBe(ledger)
    expect(++steps).toBeLessThan(100000)
  }
  expect(candidate.getOutput()).toEqual(reference.getOutput())
  expect(candidate.getUpdatedPreloadedTraces()).toEqual(reference.getUpdatedPreloadedTraces())
  if (candidate.initialBoundedRegionalRepairSolver) {
    expect(candidate.initialBoundedRegionalRepairSolver.params.repairSearchScratchStats).toBe(ledger)
  }
  if (candidate.boundedRegionalRepairSolver) {
    expect(candidate.boundedRegionalRepairSolver.params.repairSearchScratchStats).toBe(ledger)
  }
  expect(candidate.repairSearchScratchStats).toBe(ledger)
})
