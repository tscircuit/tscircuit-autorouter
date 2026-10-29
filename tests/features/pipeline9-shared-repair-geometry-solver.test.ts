import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createSharedRepairGeometryInput,
} from "../fixtures/shared-repair-geometry-input"

test("shared repair preparation retains full synthetic Joint solver states, budgets and output", (): void => {
  for (const includePreloadedCopper of [false, true]) {
    const solvers = [undefined, false, true].map((enabled) => new Pipeline9JointDrcRepairSolver(
      createSharedRepairGeometryInput(enabled, includePreloadedCopper),
    ))
    for (const solver of solvers) solver.solve()
    const outputs = solvers.map((solver) => ({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      maxIterations: solver.MAX_ITERATIONS,
      step: solver.currentPipelineStepIndex,
      routes: solver.getOutput(),
      stats: Object.fromEntries(Object.entries(solver.stats).filter(
        ([key]) => !/time|duration|elapsed|Ms$/i.test(key),
      )),
    }))
    expect(outputs[1]).toEqual(outputs[0])
    expect(outputs[2]).toEqual(outputs[0])
    expect(outputs[0]!.solved).toBeTrue()
    expect(solvers[2]!.sharedRepairGeometryStats!.preparedInputsBuilt).toBeGreaterThan(0)
    const stats = solvers[2]!.sharedRepairGeometryStats!
    expect(stats.preparationCalls).toBe(stats.preparedInputsBuilt + stats.preparedHandoffUses)
  }
})
