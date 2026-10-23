import { expect, spyOn, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

const createSolver = (): {
  solver: Pipeline9JointDrcRepairSolver
  restoreContinuation: () => void
} => {
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
  // This test exercises the later stages. Model an incomplete bounded pass
  // so the exact, B01 and final bounded children still execute.
  const initial = solver.initialBoundedRegionalRepairSolver!
  const getResult = initial.getResult.bind(initial)
  const initialResult = spyOn(initial, "getResult").mockImplementation(() => ({
    ...getResult(),
    routes: initial.params.routes,
    publishedDrcIssueCount: undefined,
  }))
  const continuation = spyOn(
    initial,
    "getRoutesForFurtherRepair",
  ).mockImplementation((): typeof initial.params.routes => initial.params.routes)
  while (!solver.exactRepairSolver && !solver.failed) solver.step()
  return {
    solver,
    restoreContinuation: (): void => {
      initialResult.mockRestore()
      continuation.mockRestore()
    },
  }
}

test("joint DRC repair exposes sequential child stages and propagates failures", (): void => {
  const { solver, restoreContinuation } = createSolver()
  const exact = solver.exactRepairSolver!
  // Keep the unresolved geometry so the post-exact stages run real repairs.
  const exactStep = spyOn(exact, "step").mockImplementation((): void => {
    exact.iterations++
    exact.solved = true
  })
  const solveSpies = [
    Pipeline9RegionalB01RepairSolver.prototype,
    Pipeline9BoundedRegionalRepairSolver.prototype,
  ].map((prototype) =>
    spyOn(prototype, "solve").mockImplementation((): never => {
      throw new Error("Joint repair must advance its active child one step")
    }),
  )
  try {
    const phases: string[] = []
    for (
      let step = 0;
      step < 20_000 && !solver.solved && !solver.failed;
      step++
    ) {
      const child = solver.activeSubSolver
      const iterations = child?.iterations
      const progress = solver.progress
      const phase = solver.getCurrentPhase()
      if (phases.at(-1) !== phase) phases.push(phase)
      solver.step()
      if (child) expect(child.iterations).toBe(iterations! + 1)
      else if (solver.activeSubSolver)
        expect(solver.activeSubSolver.iterations).toBe(0)
      expect(solver.progress).toBeGreaterThanOrEqual(progress)
    }
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(phases).toEqual([
      "exactRepairSolver",
      "regionalB01RepairSolver",
      "boundedRegionalRepairSolver",
    ])
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.regionalB01RepairSolver?.solved).toBeTrue()
    expect(solver.boundedRegionalRepairSolver?.solved).toBeTrue()
    expect(solver.progress).toBe(1)
    expect(solveSpies.every((spy) => spy.mock.calls.length === 0)).toBeTrue()
    const fixture = createBoundedRegionalRepairFixture()
    const validation = fixture.drcEvaluator({
      traces: [],
      routes: solver.getOutput(),
    })
    expect(
      Array.isArray(validation) ? validation : validation.errors,
    ).toHaveLength(0)
  } finally {
    exactStep.mockRestore()
    for (const spy of solveSpies) spy.mockRestore()
    restoreContinuation()
  }

  const {
    solver: failing,
    restoreContinuation: restoreFailingContinuation,
  } = createSolver()
  const failingExact = failing.exactRepairSolver!
  const failureStep = spyOn(failingExact, "step").mockImplementation(
    (): void => {
      failingExact.iterations++
      failingExact.failed = true
      failingExact.error = "stage failure"
    },
  )
  try {
    failing.step()
    expect(failing.failed).toBeTrue()
    expect(failing.error).toBe("stage failure")
    expect(failing.activeSubSolver).toBeNull()
    expect(failing.regionalB01RepairSolver).toBeUndefined()
    expect(failing.boundedRegionalRepairSolver).toBeUndefined()
  } finally {
    failureStep.mockRestore()
    restoreFailingContinuation()
  }
})
