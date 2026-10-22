import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import {
  HighDensityForceImproveSolver,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  Pipeline9HighDensityForceImproveSolver,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import {
  createHighDensityForceImproveRuntimeFixture,
} from "../fixtures/createHighDensityForceImproveRuntimeFixture"
import {
  expectHighDensityForceImproveState,
} from "../fixtures/expectHighDensityForceImproveState"

test("force workers retain native post-step MAX exhaustion and final-sample acceptance", async (): Promise<void> => {
  for (const maximum of [0, 1, 2, 3, 4, Infinity]) {
    const baseline = new HighDensityForceImproveSolver(
      createHighDensityForceImproveRuntimeFixture(),
    )
    const solver = new Pipeline9HighDensityForceImproveSolver(
      createHighDensityForceImproveRuntimeFixture(),
    )
    baseline.MAX_ITERATIONS = maximum
    solver.MAX_ITERATIONS = maximum
    const runtime = new SolverRuntime()
    try {
      baseline.solve()
      await solver.solveAsync(runtime)
      expectHighDensityForceImproveState(solver, baseline)
      if (maximum === 0) {
        expect(solver.activeSampleIndex).toBe(1)
        expect(solver.iterations).toBe(1)
        expect(solver.failed).toBe(true)
      }
      if (maximum === 3) {
        expect(solver.activeSampleIndex).toBe(4)
        expect(solver.iterations).toBe(4)
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
      }
    } finally {
      await runtime.dispose()
    }
  }
})
