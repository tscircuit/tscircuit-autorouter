import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a reference-clean bounded repair completes the joint solver before the broad portfolio", (): void => {
  const fixture = createBoundedRegionalRepairFixture(3)
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
  let progress = 0
  while (!solver.solved && !solver.failed) {
    const child = solver.activeSubSolver
    const iterations = child?.iterations
    solver.step()
    if (child) expect(child.iterations).toBe(iterations! + 1)
    expect(solver.progress).toBeGreaterThanOrEqual(progress)
    progress = solver.progress
  }
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.initialBoundedRegionalRepairSolver?.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  const budget = solver.initialBoundedRegionalRepairSolver!.budget
  expect(solver.stats.boundedRegionalRepairMaxRegions).toBe(budget.maxRegions)
  expect(solver.stats.boundedRegionalRepairMaxCandidateAttempts).toBe(
    budget.maxCandidateAttempts,
  )
  expect(solver.stats.boundedRegionalRepairMaxPathSearchNodes).toBe(
    budget.maxPathSearchNodes,
  )
  expect(solver.exactRepairSolver).toBeUndefined()
  expect(solver.regionalB01RepairSolver).toBeUndefined()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(original.length)
  for (const [index, route] of routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
  }
  const validation = fixture.drcEvaluator({ traces: [], routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(fixture.routes).toEqual(original)
})
